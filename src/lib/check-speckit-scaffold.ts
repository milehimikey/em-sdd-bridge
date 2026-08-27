/**
 * Spec-kit scaffold flag-compatibility check (MIL-150).
 *
 * `allocate-feature.ts` shells out to two spec-kit-installed bash scripts
 * with a fixed set of flags (`--json`, `--dry-run`, `--short-name`,
 * `--number`, ...) that it never negotiates or probes for at runtime --
 * see its own module doc comment. That contract is verified against the
 * spec-kit vintage pinned in `fixtures/speckit-scripts/` (see that
 * directory's own README for the exact version), not against whatever
 * `specify init` happens to download today.
 *
 * Real, observed drift (MIL-150): a scaffold produced by a fresh upstream
 * `specify init` as of 2026-08-23 shipped a core `create-new-feature.sh`
 * that does not understand `--json`/`--dry-run`/`--short-name`/`--number`
 * at all -- it silently folds unrecognized flags into the feature
 * description instead of erroring, which would otherwise surface as a
 * confusing downstream failure (a JSON parse error on non-JSON stdout, or a
 * garbled feature name) with no indication that the real cause is an
 * incompatible scaffold. This module runs BEFORE allocateFeature() and
 * fails closed with a clear, actionable message instead, naming exactly
 * which flags are missing from which file and pointing at the pinned,
 * verified-compatible scripts to substitute in (see README.md's "Verified
 * spec-kit vintage" section).
 *
 * Detection is static and deliberately conservative: it reads the
 * installed script's own source and checks for a `case` pattern arm
 * declaring each required flag (e.g. `--short-name)` or
 * `--foo|--short-name)`), rather than executing the script to observe its
 * behavior. Executing it would risk the exact silent-misparse failure mode
 * this check exists to catch (an unrecognized flag rarely errors loudly in
 * these scripts -- see the module comment above), so a real invocation
 * can't be trusted to prove compatibility one way or the other. A
 * case-pattern match can false-negative only if a future script recognizes
 * a flag through some other syntax entirely (e.g. a getopts loop) -- in
 * that unlikely event this check fails closed (reports the flag missing)
 * rather than silently passing an incompatible scaffold through.
 */

import { existsSync, readFileSync } from "node:fs";
import { coreScriptPath, gitExtensionBranchScriptPath } from "./allocate-feature.js";
import { BridgeError } from "./bridge-error.js";

/** Flags allocateCoreOnly()/allocateWithGitExtension() always pass to the
 *  core script (see allocate-feature.ts) -- required regardless of whether
 *  the git extension is installed. */
export const REQUIRED_CORE_SCRIPT_FLAGS = ["--json", "--dry-run", "--short-name", "--number"] as const;

/** Flags allocateWithGitExtension() passes to the git extension's
 *  branch-creation script. Deliberately excludes `--number` -- the
 *  extension script only ever allocates a number itself; `--number` is
 *  passed to the CORE script afterward, to align the spec dir with the
 *  branch the extension already created (see allocate-feature.ts). */
export const REQUIRED_EXTENSION_SCRIPT_FLAGS = ["--json", "--dry-run", "--short-name"] as const;

/**
 * True if `source` (a bash script's full text) declares a `case` pattern
 * arm for `flag`, alone (`--short-name)`) or combined with alternatives
 * (`--foo|--short-name)`, `--short-name|--bar)`). Anchored on `)`/`|`
 * immediately following the flag (allowing surrounding whitespace) so e.g.
 * `--dry-run` doesn't false-match a hypothetical `--dry-run-old)` arm.
 */
export function scriptDeclaresFlag(source: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\|)\\s*${escaped}\\s*(\\)|\\|)`, "m").test(source);
}

function missingFlags(scriptPath: string, requiredFlags: readonly string[]): string[] {
  const source = readFileSync(scriptPath, "utf8");
  return requiredFlags.filter((flag) => !scriptDeclaresFlag(source, flag));
}

function incompatibleMessage(scriptPath: string, missing: string[]): string {
  return (
    `${scriptPath} does not support required flag(s): ${missing.join(", ")}. This is real spec-kit/` +
    `em-sdd-bridge version drift, not a bug in your slice -- see README.md's "Verified spec-kit ` +
    `vintage" section. Replace this script (and its sibling core/extension scripts) with the ` +
    `pinned, verified-compatible copies in this package's fixtures/speckit-scripts/.specify/ tree.`
  );
}

/**
 * Fail-closed: throws a BridgeError naming every incompatible or missing
 * script found, or returns silently when the installed scaffold's core
 * script (and git-extension branch script, if installed) support every
 * flag allocate-feature.ts relies on. Never throws for a MISSING git
 * extension -- that's the documented no-git-extension fallback path
 * (allocate-feature.ts), not incompatibility.
 */
export function assertSpeckitScaffoldCompat(repoRoot: string): void {
  const failures: string[] = [];

  const corePath = coreScriptPath(repoRoot);
  if (!existsSync(corePath)) {
    failures.push(
      `Core spec-kit script not found at ${corePath} -- run \`specify init\` before running this bridge.`
    );
  } else {
    const missing = missingFlags(corePath, REQUIRED_CORE_SCRIPT_FLAGS);
    if (missing.length > 0) failures.push(incompatibleMessage(corePath, missing));
  }

  const extensionPath = gitExtensionBranchScriptPath(repoRoot);
  if (extensionPath) {
    const missing = missingFlags(extensionPath, REQUIRED_EXTENSION_SCRIPT_FLAGS);
    if (missing.length > 0) failures.push(incompatibleMessage(extensionPath, missing));
  }

  if (failures.length === 0) return;
  throw new BridgeError(
    `Spec-kit scaffold is incompatible with this bridge's script invocation (${failures.length}):\n` +
      failures.map((f) => `  - ${f}`).join("\n")
  );
}
