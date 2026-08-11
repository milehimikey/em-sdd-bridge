#!/usr/bin/env node
/**
 * Status -> PR-link automation.
 *
 * Usage:
 *   npx em-sdd-mark-implemented <slice-key> <pr-url>
 *     [--repo-root <path>] [--model <path.em>] [--file <path>]
 *
 * Flips the slice doc's `Status:` to `implemented` and fills
 * `Implemented in:` with the merged PR URL. Idempotent (safe to re-run with
 * the same URL); refuses if the slice doc can't be found, or if it's already
 * `implemented` with a *different* URL (won't silently overwrite provenance).
 *
 * `--file` bypasses `em export`-based lookup entirely (point straight at a
 * slice doc) -- handy for scripts/tests that already know the path, and
 * genuinely `em`-independent: the minimum-em-version check below only runs
 * on the `em export` lookup path, not for `--file`.
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMinimumEmVersion } from "./lib/check-em-version.js";
import { parseArgs } from "./lib/cli-args.js";
import { findRepoRoot } from "./lib/repo.js";
import { resolveModelPath, runEmExport } from "./lib/em-runner.js";
import { locateSliceDoc } from "./lib/locate-slice-doc.js";
import { applyImplementedStatus } from "./lib/mark-implemented-doc.js";
import { BridgeError } from "./lib/bridge-error.js";

export function runMarkImplemented(argv: string[]): { path: string; changed: boolean } {
  const { positional, flags } = parseArgs(argv, ["--repo-root", "--model", "--file"], []);

  const [sliceKey, prUrl] = positional;
  if (!sliceKey || !prUrl) {
    throw new BridgeError("Usage: mark-implemented.ts <slice-key> <pr-url> [--repo-root <path>] [--model <path>] [--file <path>]");
  }

  let docPath: string;
  if (flags["file"]) {
    docPath = path.resolve(flags["file"]);
  } else {
    // Minimum-em-version check runs before the `em export` lookup path it
    // guards -- see bridge.ts for the same wiring and its rationale. Not run
    // for --file, which never shells out to `em`.
    assertMinimumEmVersion();

    const repoRoot = flags["repo-root"] ?? findRepoRoot(process.cwd());
    if (!repoRoot) {
      throw new BridgeError("Could not locate a spec-kit project (no .specify/ directory found upward from cwd).");
    }
    const modelPath = resolveModelPath(repoRoot, flags["model"]);
    const exportModel = runEmExport(modelPath);
    docPath = locateSliceDoc(exportModel, modelPath, sliceKey).absolutePath;
  }

  const original = readFileSync(docPath, "utf8");
  const result = applyImplementedStatus(original, prUrl, docPath);
  if (result.changed) {
    writeFileSync(docPath, result.content, "utf8");
  }
  return { path: docPath, changed: result.changed };
}

// realpathSync on both sides -- npm installs `bin` entries as symlinks
// (node_modules/.bin/em-sdd-mark-implemented -> ../em-sdd-bridge/dist/mark-implemented.js),
// so a plain path.resolve() comparison of argv[1] vs. import.meta.url never
// matches when run the way every real npx/npm-installed consumer runs this,
// making the CLI silently no-op. realpathSync follows the symlink on both
// sides so the comparison is against the same real file.
const isMain =
  !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const result = runMarkImplemented(process.argv.slice(2));
    console.log(result.changed ? `Marked implemented: ${result.path}` : `Already implemented (no-op): ${result.path}`);
  } catch (err) {
    if (err instanceof BridgeError) {
      console.error(`mark-implemented: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
