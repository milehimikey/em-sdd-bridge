#!/usr/bin/env node
/**
 * Status -> PR-link automation.
 *
 * Usage:
 *   npx em-sdd-mark-implemented <slice-key> <pr-url>
 *     [--repo-root <path>] [--model <path.em>]
 *
 * MIL-104: a thin wrapper over `em slice mark-implemented <file> <slice-key>
 * <pr-url>` (MIL-103, em >=1.8.0) -- the native frontmatter writer, and the
 * write-side mirror of MIL-94 delegating slice readiness to `em validate
 * --slice-ready`: one writer implementation (em's), not two. This module's
 * only jobs are (1) resolve which `.em` model file to hand `em`, using the
 * exact same resolveModelPath convention `em export`/`em validate
 * --slice-ready` already use (lib/em-runner.ts), and (2) surface em's exit
 * code and stdout/stderr to the caller, unmodified and unparsed.
 *
 * Idempotent (safe to re-run with the same URL, per `em`'s own behavior);
 * refuses -- throws, non-zero exit -- if the slice doc is already
 * `implemented` with a *different* URL, or the slice key doesn't resolve in
 * the model. em's own diagnostic text is what's shown either way; this
 * module never parses or pattern-matches it.
 *
 * This bridge no longer edits a slice doc's body at all for this command --
 * see lib/em-runner.ts's runEmMarkImplemented and the retired
 * lib/mark-implemented-doc.ts (MIL-104).
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertMinimumEmVersion } from "./lib/check-em-version.js";
import { parseArgs } from "./lib/cli-args.js";
import { findRepoRoot } from "./lib/repo.js";
import { resolveModelPath, runEmMarkImplemented } from "./lib/em-runner.js";
import { BridgeError } from "./lib/bridge-error.js";

export function runMarkImplemented(argv: string[]): { modelPath: string; output: string } {
  const { positional, flags } = parseArgs(argv, ["--repo-root", "--model"], []);

  const [sliceKey, prUrl] = positional;
  if (!sliceKey || !prUrl) {
    throw new BridgeError("Usage: mark-implemented.ts <slice-key> <pr-url> [--repo-root <path>] [--model <path.em>]");
  }

  // Minimum-em-version check runs before shelling out to `em` -- same
  // wiring/rationale as bridge.ts. Every invocation now shells out to `em`
  // (there is no longer an em-independent bypass path -- see the retired
  // --file flag's history), so this check is unconditional here.
  assertMinimumEmVersion();

  const repoRoot = flags["repo-root"] ?? findRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new BridgeError("Could not locate a spec-kit project (no .specify/ directory found upward from cwd).");
  }
  const modelPath = resolveModelPath(repoRoot, flags["model"]);
  const output = runEmMarkImplemented(modelPath, sliceKey, prUrl);
  return { modelPath, output };
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
    console.log(result.output);
  } catch (err) {
    if (err instanceof BridgeError) {
      console.error(`mark-implemented: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
