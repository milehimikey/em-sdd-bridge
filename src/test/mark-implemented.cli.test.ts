import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMarkImplemented } from "../mark-implemented.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
const fixtureModel = path.join(fixturesDir, "model.em");
const fixtureDoc = path.join(fixturesDir, "slices", "record-ping.md");

function hasEm(): boolean {
  try {
    execFileSync("em", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

// Copies fixtures/model.em + fixtures/slices/record-ping.md into a scratch
// dir (never the real fixtures, which every real invocation of
// `em slice mark-implemented` actually WRITES to) and returns the scratch
// dir to pass as --repo-root. resolveModelPath finds the sole `*.em` file
// there with no --model override needed, mirroring the convention
// em-runner.test.ts exercises directly.
function copyFixturesToTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-mark-implemented-"));
  tmpDirs.push(dir);
  mkdirSync(path.join(dir, "slices"));
  writeFileSync(path.join(dir, "model.em"), readFileSync(fixtureModel, "utf8"));
  writeFileSync(path.join(dir, "slices", "record-ping.md"), readFileSync(fixtureDoc, "utf8"));
  return dir;
}

describe("runMarkImplemented (argv parsing)", () => {
  it("throws a BridgeError usage message when slice-key or pr-url is missing", () => {
    expect(() => runMarkImplemented([])).toThrow(BridgeError);
    expect(() => runMarkImplemented(["record-ping"])).toThrow(/Usage: mark-implemented/);
  });
});

// Real, unmocked shell-out to `em slice mark-implemented`, gated like every
// other em-dependent test in this suite (see slice-readiness.test.ts for the
// same pattern applied to `em validate --slice-ready`). This module is now a
// thin wrapper with nothing left to unit-test in isolation from `em` itself
// -- its only jobs (resolve the model path, shell out, relay em's own
// stdout/stderr/exit code unmodified) are exactly what these tests exercise
// against the real binary. Skips gracefully in CI, where `em` is
// deliberately not installed.
describe.skipIf(!hasEm())("runMarkImplemented (real em, thin wrapper)", () => {
  it("flips a fresh slice doc to implemented via `em slice mark-implemented`, then no-ops on re-run with the same URL", () => {
    const repoRoot = copyFixturesToTmp();
    const prUrl = "https://github.com/example-org/example-repo/pull/123";

    const first = runMarkImplemented(["record-ping", prUrl, "--repo-root", repoRoot]);
    expect(first.output).toMatch(/^marked implemented:/);
    let content = readFileSync(path.join(repoRoot, "slices", "record-ping.md"), "utf8");
    expect(content).toContain("status: implemented");
    expect(content).toContain(`implementedIn: ${prUrl}`);

    const second = runMarkImplemented(["record-ping", prUrl, "--repo-root", repoRoot]);
    expect(second.output).toMatch(/^already implemented \(no-op\):/);
    content = readFileSync(path.join(repoRoot, "slices", "record-ping.md"), "utf8");
    expect(content).toContain(`implementedIn: ${prUrl}`);
  });

  it("refuses (non-zero exit, em's stderr forwarded) on a second run with a different URL", () => {
    const repoRoot = copyFixturesToTmp();
    runMarkImplemented(["record-ping", "https://github.com/org/repo/pull/1", "--repo-root", repoRoot]);
    expect(() =>
      runMarkImplemented(["record-ping", "https://github.com/org/repo/pull/2", "--repo-root", repoRoot])
    ).toThrow(/already marked implemented with a different URL/);
  });

  it("refuses (BridgeError) when the slice key doesn't resolve in the model", () => {
    const repoRoot = copyFixturesToTmp();
    expect(() =>
      runMarkImplemented(["nonexistent-key", "https://github.com/org/repo/pull/1", "--repo-root", repoRoot])
    ).toThrow(BridgeError);
    expect(() =>
      runMarkImplemented(["nonexistent-key", "https://github.com/org/repo/pull/1", "--repo-root", repoRoot])
    ).toThrow(/no slice with export key/);
  });

  it("accepts an explicit --model override alongside --repo-root", () => {
    const repoRoot = copyFixturesToTmp();
    const prUrl = "https://github.com/org/repo/pull/7";
    const result = runMarkImplemented([
      "record-ping",
      prUrl,
      "--repo-root",
      repoRoot,
      "--model",
      path.join(repoRoot, "model.em"),
    ]);
    expect(result.modelPath).toBe(path.join(repoRoot, "model.em"));
    expect(result.output).toMatch(/^marked implemented:/);
  });
});
