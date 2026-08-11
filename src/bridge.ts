#!/usr/bin/env node
/**
 * em-slice -> spec-kit bridge.
 *
 * Usage:
 *   npx em-sdd-bridge <slice-key> [<slice-key>]
 *     [--repo-root <path>] [--model <path.em>] [--slices-dir <dir>]
 *     [--dry-run] [--skip-design-gate]
 *
 * See lib/*.ts for the pipeline: minimum-em-version check -> em export ->
 * locate + parse slice doc(s) -> validate readiness + (for 2 keys) the
 * pattern-pair -> the design-completeness / events-first preconditions ->
 * allocate the spec-kit feature (git branch, created + checked out, via the
 * installed git extension when present; spec dir, under the SAME number,
 * via the installed create-new-feature.sh -- see lib/allocate-feature.ts) ->
 * render spec.md per your project's slice-to-spec mapping contract.
 *
 * Never calls /speckit.specify -- spec.md is written directly.
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

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMinimumEmVersion } from "./lib/check-em-version.js";
import { parseArgs } from "./lib/cli-args.js";
import { findRepoRoot } from "./lib/repo.js";
import { resolveModelPath, runEmExport } from "./lib/em-runner.js";
import { validateSliceKeys } from "./lib/pattern-validate.js";
import { locateSliceDoc } from "./lib/locate-slice-doc.js";
import { parseSliceDoc, assertReadyToImplement } from "./lib/slice-doc.js";
import { allocateFeature } from "./lib/allocate-feature.js";
import { buildSpecMarkdown } from "./lib/spec-builder.js";
import { assertPreconditions } from "./lib/preconditions.js";
import { BridgeError } from "./lib/bridge-error.js";
import type { ExportedSlice } from "./lib/export-model.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function runBridge(argv: string[]): { branchName: string; specFile: string | null; content: string } {
  // Minimum-em-version check runs before any other precondition -- an
  // unsupported `em` invalidates everything downstream (export shape,
  // slice/pattern semantics), so failing here first keeps later error
  // messages honest about what actually went wrong.
  assertMinimumEmVersion();

  const { positional, flags, booleans } = parseArgs(
    argv,
    ["--repo-root", "--model", "--slices-dir", "--doc"],
    ["--dry-run", "--skip-design-gate"]
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

  // --doc: explicit slice-doc path (relative to the model dir), shared by ALL keys.
  // Needed when the export lost the note binding (see locate-slice-doc.ts), and for
  // pattern-pair bundles, which share ONE doc (see your project's mapping contract).
  const docOverride = flags["doc"];

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
  const primaryDoc = parseSliceDoc(readFileSync(primaryLocated.absolutePath, "utf8"), primaryLocated.relativePath);
  assertReadyToImplement(primaryDoc, primaryLocated.relativePath);

  let secondaryDoc;
  let secondaryLocated;
  if (secondary) {
    if (docOverride) {
      // Pattern-pair sharing one doc: the pair IS one slice doc (see your
      // project's mapping contract).
      secondaryLocated = primaryLocated;
      secondaryDoc = primaryDoc;
    } else {
      secondaryLocated = locateSliceDoc(exportModel, modelPath, secondary.key);
      secondaryDoc = parseSliceDoc(readFileSync(secondaryLocated.absolutePath, "utf8"), secondaryLocated.relativePath);
      assertReadyToImplement(secondaryDoc, secondaryLocated.relativePath);
    }

    if (!/automation|translation/i.test(primaryDoc.pattern)) {
      throw new BridgeError(
        `Bundling requires the primary (first) slice key to be the Automation/Translation reactor. ` +
          `"${primary.key}" declares Pattern: "${primaryDoc.pattern}".`
      );
    }
  }

  const shortName = primary.key;
  const description = primaryDoc.intent || primaryDoc.name;
  const dryRun = booleans.has("dry-run");

  const allocated = allocateFeature({ repoRoot, shortName, description, dryRun });

  const sliceDocRelPaths = isBundle
    ? [primaryLocated.relativePath, secondaryLocated!.relativePath]
    : [primaryLocated.relativePath];

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
    return { branchName: allocated.branchName, specFile: null, content };
  }

  writeFileSync(allocated.specFile, content, "utf8");
  return { branchName: allocated.branchName, specFile: allocated.specFile, content };
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
    if (result.specFile) {
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
