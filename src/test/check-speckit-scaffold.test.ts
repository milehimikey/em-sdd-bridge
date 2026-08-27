import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSpeckitScaffoldCompat,
  REQUIRED_CORE_SCRIPT_FLAGS,
  REQUIRED_EXTENSION_SCRIPT_FLAGS,
  scriptDeclaresFlag,
} from "../lib/check-speckit-scaffold.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
const goodScaffoldRoot = path.join(fixturesDir, "speckit-scripts");

const tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

// A hand-written stand-in for the real drift MIL-150 observed: a core script
// that only understands --json/--dry-run and silently treats any other flag
// (--short-name, --number) as part of the feature description, rather than
// erroring. No --help output either, matching a plausible older/newer vintage
// that never grew this flag surface -- this module must detect the missing
// case arms from the script's own source, not from --help text or a runtime
// probe (see check-speckit-scaffold.ts's module comment for why).
const INCOMPATIBLE_CORE_SCRIPT = `#!/usr/bin/env bash
set -e
JSON_MODE=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=true ;;
    --dry-run) DRY_RUN=true ;;
    *) DESCRIPTION="$DESCRIPTION $arg" ;;
  esac
done
echo '{"BRANCH_NAME":"001-whatever","SPEC_FILE":"specs/001-whatever/spec.md","FEATURE_NUM":"001"}'
`;

const INCOMPATIBLE_EXTENSION_SCRIPT = `#!/usr/bin/env bash
set -e
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=true ;;
    *) DESCRIPTION="$DESCRIPTION $arg" ;;
  esac
done
echo '{"BRANCH_NAME":"001-whatever","FEATURE_NUM":"001"}'
`;

function writeCoreScript(repoRoot: string, content: string): void {
  const dir = path.join(repoRoot, ".specify", "scripts", "bash");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "create-new-feature.sh"), content, { mode: 0o755 });
}

function writeExtensionScript(repoRoot: string, filename: string, content: string): void {
  const dir = path.join(repoRoot, ".specify", "extensions", "git", "scripts", "bash");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), content, { mode: 0o755 });
}

describe("scriptDeclaresFlag", () => {
  it("matches a flag declared alone as a case arm", () => {
    expect(scriptDeclaresFlag("case \"$arg\" in\n  --short-name)\n    ;;\nesac", "--short-name")).toBe(true);
  });

  it("matches a flag declared alongside alternatives", () => {
    expect(scriptDeclaresFlag("--foo|--short-name)", "--short-name")).toBe(true);
    expect(scriptDeclaresFlag("--short-name|--bar)", "--short-name")).toBe(true);
  });

  it("does not match when the flag is absent", () => {
    expect(scriptDeclaresFlag("case \"$arg\" in\n  --json)\n    ;;\nesac", "--short-name")).toBe(false);
  });

  it("does not false-match a longer flag name sharing a prefix", () => {
    expect(scriptDeclaresFlag("--dry-run-old)", "--dry-run")).toBe(false);
  });
});

describe("assertSpeckitScaffoldCompat", () => {
  it("passes against the real, pinned, verified-compatible fixture scaffold", () => {
    expect(() => assertSpeckitScaffoldCompat(goodScaffoldRoot)).not.toThrow();
  });

  it("throws a BridgeError when the core script is missing entirely", () => {
    const repoRoot = mkTmp("speckit-compat-missing-core-");
    mkdirSync(path.join(repoRoot, ".specify"), { recursive: true });
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(BridgeError);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(/Core spec-kit script not found/);
  });

  it("throws a BridgeError naming every missing flag when the core script lacks them", () => {
    const repoRoot = mkTmp("speckit-compat-bad-core-");
    writeCoreScript(repoRoot, INCOMPATIBLE_CORE_SCRIPT);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(BridgeError);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(/--short-name/);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(/--number/);
    // Flags the script DOES support are never reported as missing.
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).not.toThrow(/does not support required flag\(s\): .*--json/);
  });

  it("points at README's Verified spec-kit vintage section and the fixtures to substitute in", () => {
    const repoRoot = mkTmp("speckit-compat-message-");
    writeCoreScript(repoRoot, INCOMPATIBLE_CORE_SCRIPT);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(/Verified spec-kit vintage/);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(/fixtures\/speckit-scripts/);
  });

  it("passes when no git extension is installed at all (documented fallback, not incompatibility)", () => {
    const repoRoot = mkTmp("speckit-compat-no-extension-");
    const goodCore = readFileSync(
      path.join(goodScaffoldRoot, ".specify", "scripts", "bash", "create-new-feature.sh"),
      "utf8"
    );
    writeCoreScript(repoRoot, goodCore);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).not.toThrow();
  });

  it("also checks the git extension's branch script when installed (current filename)", () => {
    const repoRoot = mkTmp("speckit-compat-bad-extension-current-");
    const goodCore = readFileSync(
      path.join(goodScaffoldRoot, ".specify", "scripts", "bash", "create-new-feature.sh"),
      "utf8"
    );
    writeCoreScript(repoRoot, goodCore);
    writeExtensionScript(repoRoot, "create-new-feature.sh", INCOMPATIBLE_EXTENSION_SCRIPT);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(BridgeError);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(/--short-name/);
  });

  it("also checks the git extension's branch script when installed (legacy filename)", () => {
    const repoRoot = mkTmp("speckit-compat-bad-extension-legacy-");
    const goodCore = readFileSync(
      path.join(goodScaffoldRoot, ".specify", "scripts", "bash", "create-new-feature.sh"),
      "utf8"
    );
    writeCoreScript(repoRoot, goodCore);
    writeExtensionScript(repoRoot, "create-new-feature-branch.sh", INCOMPATIBLE_EXTENSION_SCRIPT);
    expect(() => assertSpeckitScaffoldCompat(repoRoot)).toThrow(BridgeError);
  });

  it("never requires --number from the git extension script", () => {
    // REQUIRED_EXTENSION_SCRIPT_FLAGS deliberately excludes --number -- the
    // extension script allocates its own number; --number is passed to the
    // CORE script afterward to align the spec dir (see allocate-feature.ts).
    expect(REQUIRED_EXTENSION_SCRIPT_FLAGS).not.toContain("--number");
    expect(REQUIRED_CORE_SCRIPT_FLAGS).toContain("--number");
  });
});
