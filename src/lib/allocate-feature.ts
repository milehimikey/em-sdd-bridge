/**
 * Allocates a spec-kit feature: a numbered git branch, a `specs/NNN-slug/`
 * directory, and `spec.md` (template copy -- `bridge.ts` overwrites it with
 * the rendered content right after). Wraps the installed spec-kit scripts
 * rather than reimplementing branch/number allocation:
 *
 *   - `.specify/scripts/bash/create-new-feature.sh` (core, always installed)
 *     allocates the `specs/NNN-slug/` dir + `spec.md` + `.specify/feature.json`.
 *     It does NOT touch git at all -- no branch, no checkout.
 *   - `.specify/extensions/git/scripts/bash/create-new-feature-branch.sh`
 *     (optional git extension) allocates + creates + checks out the `NNN-slug`
 *     git branch. It does NOT touch `specs/` or `.specify/feature.json`.
 *
 * When the git extension is installed, this module runs it FIRST (so the
 * branch is created and checked out) and then forces the core script to
 * allocate the SAME number via `--number`, so the spec dir lines up with the
 * branch in one `bridge.ts` invocation -- no separate hand-rolled branch step,
 * and (for the extension's real, non-dry-run allocation) no naming race,
 * since the extension's own numbering considers local branches, `git fetch
 * --all --prune`-refreshed remote branches, AND `specs/` -- not just `specs/`
 * like the core script alone.
 *
 * Numbers are aligned *explicitly*, not by assumption: `create-new-feature.sh`
 * does not read `SPECIFY_FEATURE`/`SPECIFY_FEATURE_DIRECTORY` for its own
 * numbering (those only inform *later* spec-kit commands, via common.sh's
 * `get_current_branch`) -- it only understands `--number`. So the branch
 * extension's `FEATURE_NUM` is passed straight through. `--number` is itself
 * only a *preference* in the core script: if a `specs/` dir already owns that
 * prefix (e.g. a concurrent allocation raced ahead between the two script
 * calls), it silently bumps to the next free number instead of failing --
 * which would silently detach the spec dir from the branch the extension
 * already created and checked out. This module fails loudly instead.
 *
 * When the git extension is absent, this module falls back to the original
 * core-script-only behavior (no branch is created; only the spec dir/number
 * are allocated) so repos without the extension keep working unchanged.
 *
 * Dual-layout adaptation: a spec-kit git extension may ship its
 * branch-creation script as
 * `.specify/extensions/git/scripts/bash/create-new-feature.sh` (same
 * basename as the core script, disambiguated only by directory) on current
 * spec-kit, or as `create-new-feature-branch.sh` on an older spec-kit
 * vintage. Read in full and diffed across both filenames: the CLI contract
 * is IDENTICAL for everything this module relies on -- `--json`, `--dry-run`,
 * `--short-name <v>`, `--number N`, `--allow-existing-branch`, `--timestamp`,
 * `<description>` in, `{"BRANCH_NAME","FEATURE_NUM"}` (+ `DRY_RUN:true` when
 * dry-run) out on stdout, branch created + checked out, `specs/` and
 * `.specify/feature.json` untouched. Only the filename moved. This module
 * therefore probes BOTH layouts -- the current filename first (preferred,
 * since it's what any project on a current spec-kit actually ships),
 * falling back to the older-vintage `create-new-feature-branch.sh` name for
 * projects still on that vintage -- rather than hardcoding one path and
 * silently losing the fast (single invocation, race-free) allocation path
 * against either vintage.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { BridgeError } from "./bridge-error.js";
import { cleanGitEnv } from "./clean-git-env.js";

export interface AllocatedFeature {
  branchName: string;
  specFile: string;
  featureNum: string;
}

export interface AllocateFeatureOptions {
  repoRoot: string;
  shortName: string;
  description: string;
  /** Compute names only; do not create any files or git branches (both scripts'
   *  own --dry-run). */
  dryRun?: boolean;
}

interface ExtensionBranchResult {
  BRANCH_NAME: string;
  FEATURE_NUM: string;
  DRY_RUN?: boolean;
}

interface CoreFeatureResult {
  BRANCH_NAME: string;
  SPEC_FILE: string;
  FEATURE_NUM: string;
  DRY_RUN?: boolean;
}

function runJsonScript<T>(script: string, args: string[], repoRoot: string): T {
  const stdout = execFileSync(script, args, {
    cwd: repoRoot,
    encoding: "utf8",
    // The allocation scripts call git. Scrub hook-exported GIT_* vars so git
    // discovers the repo from cwd, not from a calling hook's environment.
    env: cleanGitEnv(),
  });
  return JSON.parse(stdout.trim()) as T;
}

/** Exported so lib/check-speckit-scaffold.ts can probe the same file this
 *  module actually invokes, rather than re-deriving the path independently
 *  and risking the two drifting apart. */
export function coreScriptPath(repoRoot: string): string {
  return path.join(repoRoot, ".specify", "scripts", "bash", "create-new-feature.sh");
}

/**
 * Locates the git extension's branch-creation script, preferring the
 * current spec-kit filename and falling back to the older-vintage name --
 * see the module doc comment above for the verified-identical contract both
 * filenames share. Returns undefined if neither exists (no git extension
 * installed at all). Exported for the same reason as coreScriptPath above.
 */
export function gitExtensionBranchScriptPath(repoRoot: string): string | undefined {
  const bashDir = path.join(repoRoot, ".specify", "extensions", "git", "scripts", "bash");
  const current = path.join(bashDir, "create-new-feature.sh");
  if (existsSync(current)) return current;
  const legacy = path.join(bashDir, "create-new-feature-branch.sh");
  if (existsSync(legacy)) return legacy;
  return undefined;
}

function allocateCoreOnly(opts: AllocateFeatureOptions): AllocatedFeature {
  const args = ["--json", "--short-name", opts.shortName];
  if (opts.dryRun) args.push("--dry-run");
  args.push(opts.description);

  const parsed = runJsonScript<CoreFeatureResult>(coreScriptPath(opts.repoRoot), args, opts.repoRoot);
  return { branchName: parsed.BRANCH_NAME, specFile: parsed.SPEC_FILE, featureNum: parsed.FEATURE_NUM };
}

function allocateWithGitExtension(opts: AllocateFeatureOptions, extensionScript: string): AllocatedFeature {
  // Step 1: allocate + (unless --dry-run) create and check out the numbered
  // branch.
  const branchArgs = ["--json", "--short-name", opts.shortName];
  if (opts.dryRun) branchArgs.push("--dry-run");
  branchArgs.push(opts.description);
  const branch = runJsonScript<ExtensionBranchResult>(extensionScript, branchArgs, opts.repoRoot);

  // Step 2: allocate the spec dir under the SAME number, using the exact
  // (zero-padded) value the extension emitted.
  const featureArgs = ["--json", "--short-name", opts.shortName, "--number", branch.FEATURE_NUM];
  if (opts.dryRun) featureArgs.push("--dry-run");
  featureArgs.push(opts.description);
  const feature = runJsonScript<CoreFeatureResult>(coreScriptPath(opts.repoRoot), featureArgs, opts.repoRoot);

  if (feature.BRANCH_NAME !== branch.BRANCH_NAME) {
    throw new BridgeError(
      `allocateFeature: branch/spec-dir name mismatch after aligning by number -- ` +
        `the git extension allocated branch "${branch.BRANCH_NAME}" but the core script ` +
        `allocated spec dir "${feature.BRANCH_NAME}" for the same --number ${branch.FEATURE_NUM} ` +
        `(a concurrent allocation likely raced ahead, or a git-config.yml branch_template ` +
        `disagrees with the core script's fixed "{number}-{slug}" naming). ` +
        (opts.dryRun
          ? "No branch or files were created (--dry-run); just retry."
          : `Branch "${branch.BRANCH_NAME}" was already created and checked out -- reconcile or ` +
            `delete it (and the "${feature.BRANCH_NAME}" spec dir, if created) before retrying.`)
    );
  }

  return { branchName: feature.BRANCH_NAME, specFile: feature.SPEC_FILE, featureNum: feature.FEATURE_NUM };
}

export function allocateFeature(opts: AllocateFeatureOptions): AllocatedFeature {
  const coreScript = coreScriptPath(opts.repoRoot);
  if (!existsSync(coreScript)) {
    throw new BridgeError(
      `Missing spec-kit scaffold: expected the core allocation script at ${coreScript}, but it ` +
        `does not exist. Run spec-kit init first (e.g. \`specify init\`) to install the scaffold, ` +
        `then retry.`
    );
  }

  const extensionScript = gitExtensionBranchScriptPath(opts.repoRoot);
  if (extensionScript) {
    return allocateWithGitExtension(opts, extensionScript);
  }
  return allocateCoreOnly(opts);
}
