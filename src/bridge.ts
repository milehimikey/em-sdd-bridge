#!/usr/bin/env node
/**
 * em-slice -> spec-kit bridge.
 *
 * Usage:
 *   npx em-sdd-bridge <slice-key> [<slice-key>]
 *     [--repo-root <path>] [--model <path.em>] [--slices-dir <dir>]
 *     [--symlink] [--dry-run] [--skip-design-gate]
 *
 * See lib/*.ts for the pipeline: minimum-em-version check -> em export ->
 * validate the pattern-pair (for 2 keys, from export's slice.pattern) ->
 * the design-completeness / events-first preconditions -> per-key readiness
 * gate (delegated to `em validate --slice-ready`, lib/slice-readiness.ts) ->
 * locate + parse slice doc(s)' body content -> allocate the spec-kit feature
 * (git branch, created + checked out, via the installed git extension when
 * present; spec dir, under the SAME number, via the installed
 * create-new-feature.sh -- see lib/allocate-feature.ts) -> materialize
 * spec.md.
 *
 * Materialization has two modes (the "who bends" adapter decision):
 *
 *   - default (emission): render spec.md per your project's slice-to-spec
 *     mapping contract. The fallback adapter, and the executable proof the
 *     mapping is total.
 *   - --symlink (redirection): write NO rendered content at all -- replace
 *     the template-copied spec.md with a relative symlink to the ratified
 *     slice doc itself. Downstream phases consume the slice doc directly;
 *     shell-layer existence checks ([[ -f spec.md ]]) pass through the
 *     link. Every gate this bridge runs (minimum em version, readiness,
 *     pattern validation, design-completeness/events-first) runs identically
 *     in both modes -- the redirect keeps the gates and drops only the
 *     rendering. The Traceability line, which emission renders into spec.md,
 *     is returned/printed instead for the PR description. Two-doc bundles
 *     have no single file to link (see the guard below). POSIX only: real
 *     symlink creation on Windows requires elevated privileges -- use
 *     emission there.
 *
 * Never calls /speckit.specify -- spec.md is written directly (or linked).
 *
 * --skip-design-gate bypasses the design-completeness / events-first
 * preconditions (lib/preconditions.ts) entirely and prints a loud warning
 * when used. This exists ONLY to let this package's own test suite exercise
 * bridge mechanics (allocation, spec rendering) independent of whether a
 * real events-first source tree or a TypeSpec compiler happens to be
 * available in the environment running the tests. It must never be used for
 * a real slice implementation: doing so re-opens exactly the "an autonomous
 * agent walks past a warning" gap the design-completeness gate exists to
 * close.
 */

import { readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMinimumEmVersion } from "./lib/check-em-version.js";
import { parseArgs } from "./lib/cli-args.js";
import { findRepoRoot } from "./lib/repo.js";
import { resolveModelPath, runEmExport } from "./lib/em-runner.js";
import { validateSliceKeys } from "./lib/pattern-validate.js";
import { locateSliceDoc } from "./lib/locate-slice-doc.js";
import { parseSliceDoc } from "./lib/slice-doc.js";
import { assertSliceReady } from "./lib/slice-readiness.js";
import { allocateFeature } from "./lib/allocate-feature.js";
import { buildSpecMarkdown, buildTraceabilityLine } from "./lib/spec-builder.js";
import { assertPreconditions } from "./lib/preconditions.js";
import { BridgeError } from "./lib/bridge-error.js";
import type { ExportedSlice } from "./lib/export-model.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface BridgeResult {
  branchName: string;
  specFile: string | null;
  /** Emission: the full rendered spec.md. Symlink mode: the Traceability
   *  block for the PR description (there is no rendered file to carry it). */
  content: string;
  mode: "emit" | "symlink";
  /** Symlink mode only: the relative link target (from the spec dir to the
   *  slice doc), exactly as written into the symlink. */
  symlinkTarget?: string;
}

export function runBridge(argv: string[]): BridgeResult {
  // Minimum-em-version check runs before any other precondition -- an
  // unsupported `em` invalidates everything downstream (export shape,
  // slice/pattern semantics), so failing here first keeps later error
  // messages honest about what actually went wrong.
  assertMinimumEmVersion();

  const { positional, flags, booleans } = parseArgs(
    argv,
    ["--repo-root", "--model", "--slices-dir", "--doc"],
    ["--dry-run", "--skip-design-gate", "--symlink"]
  );

  const keys = positional;
  if (keys.length < 1) {
    throw new BridgeError(
      "Usage: bridge.ts <slice-key> [<slice-key>] [--repo-root <path>] [--model <path>] [--dry-run] [--skip-design-gate]"
    );
  }

  const repoRoot = flags["repo-root"] ?? findRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new BridgeError("Could not locate a spec-kit project (no .specify/ directory found upward from cwd).");
  }

  const modelPath = resolveModelPath(repoRoot, flags["model"]);
  const exportModel = runEmExport(modelPath);

  const { primary, secondary } = validateSliceKeys(exportModel, keys);
  const isBundle = !!secondary;

  // --doc: explicit slice-doc path (relative to the model dir), applied to
  // whichever key(s) don't otherwise resolve a note binding. Needed when the
  // export lost the note binding (see locate-slice-doc.ts).
  // NOTE: --doc affects only which file THIS bridge reads/links for
  // rendering -- it has no effect on the readiness gate below, which is
  // fully delegated to `em validate --slice-ready` and always evaluates the
  // model's own note-bound doc (the literal `slices/<key>.md` convention
  // path) for each key, independent of --doc. This means a bundle whose two
  // keys "share one doc" is no longer a supported shape via a shared note:
  // em's readiness check demands the literal per-key convention path exist
  // (`note "slices/<secondary-key>.md"` on an element AND a file there) --
  // binding both keys' notes to the SAME path does not satisfy the
  // secondary key's own check (verified against em 1.7.0). If your pair
  // genuinely has only one written doc, place it at each key's own
  // `slices/<key>.md` (a relative filesystem symlink works -- verified) or
  // accept that only the primary key's rendering source is overridable.
  const docOverride = flags["doc"];

  const symlinkMode = booleans.has("symlink");
  if (symlinkMode && isBundle) {
    // A symlink points at exactly one file; a two-doc pattern-pair has no
    // single source to link, and (see the --doc note above) there is no
    // longer a supported "shared doc" bundle shape to link instead -- use
    // emission (which interleaves both docs into one rendering).
    throw new BridgeError(
      "--symlink cannot represent a two-doc bundle: a symlink points at one file, but this " +
        "pattern-pair resolves to two slice docs. Drop --symlink and let the bridge render the " +
        "bundled spec.md instead."
    );
  }

  // Readiness gate, per key, fully delegated to `em validate --slice-ready`
  // (lib/slice-readiness.ts) -- runs before the design-completeness gate
  // since it's a single cheap subprocess call, independent of file
  // location, and fails fast on the most common "not actually ready yet"
  // case before the more expensive checks below run.
  assertSliceReady(modelPath, primary.key);
  if (secondary) assertSliceReady(modelPath, secondary.key);

  // Design-completeness + events-first preconditions, run BEFORE feature
  // allocation and fail-closed. See lib/preconditions.ts.
  if (booleans.has("skip-design-gate")) {
    console.error(
      "bridge: WARNING --skip-design-gate is set -- bypassing the design-completeness " +
        "gate and the events-first prerequisite entirely. This must never be used for a real slice " +
        "implementation; it exists only for this package's own tests."
    );
  } else {
    const gateSlices: ExportedSlice[] = secondary ? [primary, secondary] : [primary];
    assertPreconditions({ repoRoot, modelPath, exportModel, slices: gateSlices, docOverride });
  }

  const primaryLocated = locateSliceDoc(exportModel, modelPath, primary.key, docOverride);
  const primaryDoc = parseSliceDoc(readFileSync(primaryLocated.absolutePath, "utf8"), primary.pattern, primaryLocated.relativePath);

  let secondaryDoc;
  let secondaryLocated;
  if (secondary) {
    if (docOverride) {
      // Renders the secondary from the SAME overridden doc as the primary.
      // Purely a rendering-source choice -- readiness above was already
      // gated independently per key against each key's own convention-path
      // doc, regardless of this override (see the --doc note above).
      secondaryLocated = primaryLocated;
      secondaryDoc = primaryDoc;
    } else {
      secondaryLocated = locateSliceDoc(exportModel, modelPath, secondary.key);
      secondaryDoc = parseSliceDoc(
        readFileSync(secondaryLocated.absolutePath, "utf8"),
        secondary.pattern,
        secondaryLocated.relativePath
      );
    }
    // No separate bundling re-check here: validateSliceKeys (pattern-validate.ts)
    // already guarantees, by construction, that `primary` is the reactor
    // (Automation/Translation) whenever `secondary` is set -- re-deriving the
    // same invariant from primaryDoc.pattern would only risk two checks
    // drifting apart.
  }

  const shortName = primary.key;
  const description = primaryDoc.intent || primaryDoc.name;
  const dryRun = booleans.has("dry-run");

  const allocated = allocateFeature({ repoRoot, shortName, description, dryRun });

  const sliceDocRelPaths = isBundle
    ? [primaryLocated.relativePath, secondaryLocated!.relativePath]
    : [primaryLocated.relativePath];

  if (symlinkMode) {
    // Redirection: no rendering. The spec dir's spec.md becomes a relative
    // symlink to the ratified slice doc, so every downstream consumer --
    // shell scripts checking existence, phase prompts reading FEATURE_SPEC --
    // resolves straight through to the source. Relative (not absolute) so
    // the link survives clones, worktrees, and repo moves.
    const symlinkTarget = path.relative(path.dirname(allocated.specFile), primaryLocated.absolutePath);
    // Emission renders the Traceability line into spec.md's header; with no
    // rendered file, it travels via the PR description instead.
    const traceability = buildTraceabilityLine({
      keys: isBundle ? [primary.key, secondary!.key] : [primary.key],
      pattern: primaryDoc.pattern,
      modelName: path.basename(modelPath),
      modelDir: path.dirname(modelPath),
      specFilePath: allocated.specFile,
      sliceDocRelPaths,
    });

    if (dryRun) {
      // Nothing was created (both allocation scripts ran with their own
      // --dry-run), so there is nothing to link -- report what would happen.
      return {
        branchName: allocated.branchName,
        specFile: null,
        content: traceability,
        mode: "symlink",
        symlinkTarget,
      };
    }

    // create-new-feature.sh copied the spec template into place; the symlink
    // replaces it. rm first: symlinkSync refuses to overwrite.
    rmSync(allocated.specFile, { force: true });
    symlinkSync(symlinkTarget, allocated.specFile);
    return {
      branchName: allocated.branchName,
      specFile: allocated.specFile,
      content: traceability,
      mode: "symlink",
      symlinkTarget,
    };
  }

  const content = buildSpecMarkdown({
    branchName: allocated.branchName,
    date: todayIso(),
    keys: isBundle ? [primary.key, secondary!.key] : [primary.key],
    pattern: primaryDoc.pattern,
    primaryDoc,
    secondaryDoc,
    sliceDocRelPaths,
    modelName: path.basename(modelPath),
    modelDir: path.dirname(modelPath),
    // Known before rendering -- allocateFeature() already ran above. Lets
    // buildSpecMarkdown compute the parking-lot link's real relative target
    // instead of assuming the model lives at repo root.
    specFilePath: allocated.specFile,
  });

  if (dryRun) {
    // The script's own --dry-run creates no files, so spec.md has nowhere to
    // land in the real tree -- print it instead of writing.
    return { branchName: allocated.branchName, specFile: null, content, mode: "emit" };
  }

  writeFileSync(allocated.specFile, content, "utf8");
  return { branchName: allocated.branchName, specFile: allocated.specFile, content, mode: "emit" };
}

// realpathSync on both sides -- npm installs `bin` entries as symlinks
// (node_modules/.bin/em-sdd-bridge -> ../em-sdd-bridge/dist/bridge.js), so a
// plain path.resolve() comparison of argv[1] vs. import.meta.url never
// matches when run the way every real npx/npm-installed consumer runs this,
// making the CLI silently no-op. realpathSync follows the symlink on both
// sides so the comparison is against the same real file.
const isMain =
  !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const result = runBridge(process.argv.slice(2));
    if (result.mode === "symlink") {
      if (result.specFile) {
        console.log(`Linked ${result.specFile} -> ${result.symlinkTarget} on branch ${result.branchName}`);
      } else {
        console.log(
          `--- dry-run: would link spec.md -> ${result.symlinkTarget} on branch ${result.branchName} ---`
        );
      }
      console.log(`Traceability (for the PR description):`);
      console.log(result.content);
    } else if (result.specFile) {
      console.log(`Wrote ${result.specFile} on branch ${result.branchName}`);
    } else {
      console.log(`--- dry-run: spec.md for branch ${result.branchName} ---`);
      console.log(result.content);
    }
  } catch (err) {
    if (err instanceof BridgeError) {
      console.error(`bridge: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
