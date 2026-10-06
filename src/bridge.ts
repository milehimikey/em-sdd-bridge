#!/usr/bin/env node
/**
 * em-slice -> spec-kit bridge.
 *
 * Usage:
 *   npx em-sdd-bridge <slice-key>
 *     [--repo-root <path>] [--model <path.em>] [--slices-dir <dir>]
 *     [--doc <path>] [--symlink] [--dry-run]
 *     [--skip-design-gate] [--skip-readiness-gate]
 *   npx em-sdd-bridge --help | -h | --version | -v
 *
 * One slice key per invocation. As of the merged Automation/Translation
 * reaction shape (`em` >=1.7.1, MIL-120), a reaction, the command it
 * triggers, and the event that command emits all live in ONE slice, so
 * 1 slice = 1 spec = 1 PR holds with no exception -- see
 * lib/pattern-validate.ts.
 *
 * See lib/*.ts for the pipeline: minimum-em-version check -> constitution
 * advisory (lib/check-constitution.ts, MIL-203 -- warns, never gates, if
 * .specify/memory/constitution.md is still spec-kit's unfilled template) ->
 * spec-kit scaffold flag-compatibility check (lib/check-speckit-scaffold.ts,
 * MIL-150 -- fails closed if the installed scaffold's scripts don't support
 * the flags below) -> em export -> validate the slice key (from export's
 * slice.pattern) -> the design-completeness / events-first (opt-in, #13) preconditions ->
 * readiness gate (delegated to `em validate --slice-ready`,
 * lib/slice-readiness.ts) -> locate + parse the slice doc's body content ->
 * allocate the spec-kit feature (git branch, created + checked out, via the
 * installed git extension when present; spec dir, under the SAME number,
 * via the installed create-new-feature.sh -- see lib/allocate-feature.ts) ->
 * materialize spec.md.
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
 *     is returned/printed instead for the PR description. POSIX only: real
 *     symlink creation on Windows requires elevated privileges -- use
 *     emission there.
 *
 * Never calls /speckit.specify -- spec.md is written directly (or linked).
 *
 * --skip-design-gate bypasses the design-completeness / events-first (when enabled)
 * preconditions (lib/preconditions.ts) entirely and prints a loud warning
 * when used. This exists ONLY to let this package's own test suite exercise
 * bridge mechanics (allocation, spec rendering) independent of whether a
 * real events-first source tree or a TypeSpec compiler happens to be
 * available in the environment running the tests. It must never be used for
 * a real slice implementation: doing so re-opens exactly the "an autonomous
 * agent walks past a warning" gap the design-completeness gate exists to
 * close.
 *
 * --skip-readiness-gate (#15) bypasses ONLY the readiness gate
 * (`em validate --slice-ready`), independent of --skip-design-gate, and
 * prints a loud warning. Unlike --skip-design-gate this is a supported
 * production path: it is for teams building ahead of ratification (e.g. a
 * `draft` slice with recorded build assumptions). The default is unchanged --
 * a slice that is not ready-to-implement is refused.
 */

import { existsSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMinimumEmVersion } from "./lib/check-em-version.js";
import { assertSpeckitScaffoldCompat } from "./lib/check-speckit-scaffold.js";
import { warnIfConstitutionUnfilled } from "./lib/check-constitution.js";
import { parseArgs } from "./lib/cli-args.js";
import { findRepoRoot } from "./lib/repo.js";
import { resolveModelPath, runEmExport } from "./lib/em-runner.js";
import { validateSliceKeys } from "./lib/pattern-validate.js";
import { locateSliceDoc } from "./lib/locate-slice-doc.js";
import { assertSliceDocComplete, mergeSectionAliases, parseSliceDoc } from "./lib/slice-doc.js";
import { assertSliceReady } from "./lib/slice-readiness.js";
import { allocateFeature, assertNoExistingFeature } from "./lib/allocate-feature.js";
import { buildSpecMarkdown, buildTraceabilityLine } from "./lib/spec-builder.js";
import { assertPreconditions } from "./lib/preconditions.js";
import { readBridgeConfig } from "./lib/bridge-config.js";
import { BridgeError } from "./lib/bridge-error.js";
import type { ExportedSlice } from "./lib/export-model.js";

/** Usage text for --help/-h and for the no-slice-key error (#16). Single
 *  source so the two never drift. */
const VALUE_FLAGS = ["--repo-root", "--model", "--slices-dir", "--doc"];

export const USAGE = [
  "Usage: em-sdd-bridge <slice-key> [options]",
  "",
  "Bridge one ratified em slice into a spec-kit feature (branch + spec dir + spec.md).",
  "",
  "Options:",
  "  --repo-root <path>      spec-kit project root (default: nearest ancestor with .specify/)",
  "  --model <path.em>       path to the .em model",
  "  --slices-dir <dir>      deprecated: has no effect, will be removed",
  "  --doc <path>            explicit slice-doc path (relative to the model dir)",
  "  --symlink               link spec.md to the slice doc instead of rendering it (POSIX only)",
  "  --dry-run               allocate and render nothing on disk; print what would happen",
  "  --skip-design-gate      bypass design-completeness and (when enabled) events-first checks (test use only)",
  "  --skip-readiness-gate   build a slice that is not ready-to-implement; prints a warning",
  "  -h, --help              print this usage and exit",
  "  -v, --version           print the package version and exit",
].join("\n");

/** The package version, read from package.json relative to this module. The
 *  same relative path (`../package.json`) works from src/ (tsx) and dist/. */
export function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

/** --help/-h and --version/-v. Returns the text to print (exit 0), or null
 *  when argv asks for neither. Pure of side effects and deliberately free of
 *  the em-version check and repo-root discovery, so both work with no `em`
 *  installed and outside any repo. Help wins if both are given. */
export function infoFlagOutput(argv: string[]): string | null {
  // Skip the value of each value flag, so e.g. `--doc -h` is a doc path,
  // not a help request.
  const switches = argv.filter((arg, i) => !VALUE_FLAGS.includes(argv[i - 1]));
  if (switches.includes("--help") || switches.includes("-h")) return USAGE;
  if (switches.includes("--version") || switches.includes("-v")) return readPackageVersion();
  return null;
}

/** realpath when the path exists; otherwise returned unchanged so the
 *  downstream check that owns "missing" reports it. */
function physicalPath(p: string): string {
  return existsSync(p) ? realpathSync(p) : p;
}

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
    VALUE_FLAGS,
    ["--dry-run", "--skip-design-gate", "--skip-readiness-gate", "--symlink"]
  );

  // --slices-dir never had an effect (#21); warn rather than refuse so
  // existing invocations keep working until it is removed.
  if (flags["slices-dir"] !== undefined) {
    console.error("bridge: WARNING --slices-dir is deprecated and has no effect; it will be removed in a future release.");
  }

  const keys = positional;
  if (keys.length < 1) {
    throw new BridgeError(USAGE);
  }

  const givenRepoRoot = flags["repo-root"] ?? findRepoRoot(process.cwd());
  if (!givenRepoRoot) {
    throw new BridgeError("Could not locate a spec-kit project (no .specify/ directory found upward from cwd).");
  }
  // Physical paths from here on (#19). The allocation scripts report the
  // physical spec path (pwd -P), so a repo root or model path spelled through
  // a symlink (macOS /var -> /private/var, a symlinked home) would make every
  // path.relative() between the two climb to / and back down -- a "relative"
  // --symlink target that resolves into the original checkout from a
  // worktree or clone.
  const repoRoot = physicalPath(givenRepoRoot);

  // Constitution advisory (MIL-203): warn, never gate, when
  // .specify/memory/constitution.md exists and is still spec-kit's unfilled
  // template. Runs as soon as repoRoot is known, ahead of every other
  // precondition, so the warning is visible even if a later gate refuses the
  // run. Never throws, never affects control flow -- see
  // lib/check-constitution.ts.
  warnIfConstitutionUnfilled(repoRoot);

  // `.specify/em-sdd.json`, parsed once for the whole run and shared with
  // every consumer (gates now; parser aliases and the TypeSpec command next).
  // Never throws: a malformed file surfaces as a gate failure below, so
  // --skip-design-gate keeps its historical "bypass everything" meaning.
  const bridgeConfig = readBridgeConfig(repoRoot);

  // Scaffold flag-compatibility check runs next, before any em/model work --
  // cheap (reads two script files), and an incompatible scaffold invalidates
  // the feature-allocation step regardless of what the model/slice doc say.
  // See lib/check-speckit-scaffold.ts (MIL-150).
  assertSpeckitScaffoldCompat(repoRoot);

  const modelPath = physicalPath(resolveModelPath(repoRoot, flags["model"]));
  const exportModel = runEmExport(modelPath);

  const { primary } = validateSliceKeys(exportModel, keys);

  // --doc: explicit slice-doc path (relative to the model dir), used when
  // the key doesn't otherwise resolve a note binding. Needed when the
  // export lost the note binding (see locate-slice-doc.ts).
  // NOTE: --doc affects only which file THIS bridge reads/links for
  // rendering -- it has no effect on the readiness gate below, which is
  // fully delegated to `em validate --slice-ready` and always evaluates the
  // model's own note-bound doc (the literal `slices/<key>.md` convention
  // path), independent of --doc.
  const docOverride = flags["doc"];

  const symlinkMode = booleans.has("symlink");

  // Readiness gate, fully delegated to `em validate --slice-ready`
  // (lib/slice-readiness.ts) -- runs before the design-completeness gate
  // since it's a single cheap subprocess call, independent of file
  // location, and fails fast on the most common "not actually ready yet"
  // case before the more expensive checks below run.
  // --skip-readiness-gate (#15) bypasses only this gate; the design gate
  // below is independent and keeps its own flag.
  if (booleans.has("skip-readiness-gate")) {
    console.error(
      "bridge: WARNING --skip-readiness-gate is set -- this slice is NOT ratified " +
        "(not confirmed ready-to-implement); the readiness gate was bypassed by explicit choice. " +
        "Anything built from it may change when the slice is ratified."
    );
  } else {
    assertSliceReady(modelPath, primary.key);
  }

  // Design-completeness + events-first preconditions, run BEFORE feature
  // allocation and fail-closed. See lib/preconditions.ts.
  if (booleans.has("skip-design-gate")) {
    console.error(
      "bridge: WARNING --skip-design-gate is set -- bypassing the design-completeness " +
        "gate and the events-first prerequisite (when enabled) entirely. This must never be used for a real slice " +
        "implementation; it exists only for this package's own tests."
    );
  } else {
    const gateSlices: ExportedSlice[] = [primary];
    assertPreconditions({ repoRoot, modelPath, exportModel, slices: gateSlices, docOverride }, bridgeConfig);
  }

  const primaryLocated = locateSliceDoc(exportModel, modelPath, primary.key, docOverride);
  // A malformed "sectionAliases" is reported by the design gate above; this
  // re-check only fires under --skip-design-gate, where parsing with a
  // half-applied alias table would be the silent empty-parse failure #24
  // exists to end.
  if (bridgeConfig.sectionAliasesFailure) throw new BridgeError(bridgeConfig.sectionAliasesFailure);
  const sectionAliases = mergeSectionAliases(bridgeConfig.sectionAliases);

  // `primary.name` is the export's model-derived display name -- the fallback
  // when the doc has no `# Slice:` H1 at all (#23).
  const primaryDoc = parseSliceDoc(
    readFileSync(primaryLocated.absolutePath, "utf8"),
    primary.pattern,
    primaryLocated.relativePath,
    primary.name,
    { sectionAliases }
  );
  // Fail closed on a doc whose required sections parsed empty (#24) -- a
  // successful run on a near-empty spec is exactly what spec-kit must not be
  // handed. Unlike the design gate's TypeSpec / source-tree checks this needs
  // nothing from the environment, only the doc, so --skip-design-gate does
  // NOT bypass it. --symlink mode is exempt: it renders nothing from the
  // parse (the doc itself becomes the spec), so an unrecognised heading
  // costs nothing downstream.
  if (!symlinkMode) {
    assertSliceDocComplete(primaryDoc, primaryLocated.relativePath, sectionAliases);
  }

  const shortName = primary.key;
  const description = primaryDoc.intent || primaryDoc.name;
  const dryRun = booleans.has("dry-run");

  // Refuse a second feature for the same slice (#20): re-running would
  // otherwise allocate the next number and move HEAD to a duplicate branch.
  assertNoExistingFeature(repoRoot, shortName);

  const allocated = allocateFeature({ repoRoot, shortName, description, dryRun });

  const sliceDocRelPaths = [primaryLocated.relativePath];

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
      keys: [primary.key],
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
    keys: [primary.key],
    pattern: primaryDoc.pattern,
    primaryDoc,
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
  // Handled before runBridge (and so before assertMinimumEmVersion and
  // repo-root discovery) so they work with no `em` and outside a repo.
  const info = infoFlagOutput(process.argv.slice(2));
  if (info !== null) {
    console.log(info);
    process.exit(0);
  }
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
