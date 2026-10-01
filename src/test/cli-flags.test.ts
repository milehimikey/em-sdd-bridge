import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBridge, USAGE, infoFlagOutput, readPackageVersion } from "../bridge.js";
import { cleanGitEnv } from "../lib/clean-git-env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const fixturesDir = path.join(root, "fixtures");
const fixtureRepoRoot = path.join(fixturesDir, "speckit-scripts");
const pkgVersion = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string })
  .version;

function hasEm(): boolean {
  try {
    execFileSync("em", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const scratchDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (scratchDirs.length) rmSync(scratchDirs.pop()!, { recursive: true, force: true });
});

// Spawn the real CLI via tsx from a non-repo cwd; --help/--version must not
// need em or a repo.
function runCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const outside = mkdtempSync(path.join(tmpdir(), "bridge-cli-flags-cwd-"));
  scratchDirs.push(outside);
  return spawnSync(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), path.join(root, "src", "bridge.ts"), ...args], {
    cwd: outside,
    encoding: "utf8",
    env,
  });
}

const ALL_FLAGS = [
  "--repo-root",
  "--model",
  "--slices-dir",
  "--doc",
  "--symlink",
  "--dry-run",
  "--skip-design-gate",
  "--skip-readiness-gate",
  "--help",
  "--version",
];

describe("--help / --version (#16)", () => {
  it("usage text lists every flag", () => {
    for (const flag of ALL_FLAGS) expect(USAGE).toContain(flag);
    expect(USAGE).toContain("-h");
    expect(USAGE).toContain("-v");
  });

  it("infoFlagOutput maps help/version flags and ignores everything else", () => {
    expect(infoFlagOutput(["--help"])).toBe(USAGE);
    expect(infoFlagOutput(["record-ping", "-h"])).toBe(USAGE);
    expect(infoFlagOutput(["--version"])).toBe(pkgVersion);
    expect(infoFlagOutput(["-v"])).toBe(pkgVersion);
    expect(infoFlagOutput(["record-ping", "--dry-run"])).toBeNull();
    // A value flag's value is never read as a switch.
    expect(infoFlagOutput(["record-ping", "--doc", "-h"])).toBeNull();
    expect(infoFlagOutput(["record-ping", "--model", "-v"])).toBeNull();
    expect(readPackageVersion()).toBe(pkgVersion);
  });

  it.each([["--help"], ["-h"]])("CLI %s prints full usage to stdout, exit 0, outside a repo with no em", (flag) => {
    // PATH stripped to node's own dir: proves no em/git dependency.
    const res = runCli([flag], { ...process.env, PATH: path.dirname(process.execPath) });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(USAGE);
  });

  it.each([["--version"], ["-v"]])("CLI %s prints the package version, exit 0, outside a repo with no em", (flag) => {
    const res = runCli([flag], { ...process.env, PATH: path.dirname(process.execPath) });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(pkgVersion);
  });

  it("the no-slice-key error reuses the usage text", () => {
    if (!hasEm()) return; // the error is reached after the em version check
    expect(() => runBridge([])).toThrow(USAGE);
  });
});

function buildScratchRepoWithModel(): { repo: string; modelPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-cli-flags-"));
  scratchDirs.push(dir);
  mkdirSync(path.join(dir, ".specify", "scripts", "bash"), { recursive: true });
  mkdirSync(path.join(dir, ".specify", "templates"), { recursive: true });
  for (const rel of [
    [".specify", "scripts", "bash", "common.sh"],
    [".specify", "scripts", "bash", "create-new-feature.sh"],
    [".specify", "templates", "spec-template.md"],
  ]) {
    copyFileSync(path.join(fixtureRepoRoot, ...rel), path.join(dir, ...rel));
  }
  chmodSync(path.join(dir, ".specify", "scripts", "bash", "create-new-feature.sh"), 0o755);
  copyFileSync(path.join(fixturesDir, "model.em"), path.join(dir, "model.em"));
  cpSync(path.join(fixturesDir, "slices"), path.join(dir, "slices"), { recursive: true });
  // Make the convention-bound doc non-ready (status: reviewed).
  copyFileSync(path.join(fixturesDir, "slices", "not-ready.md"), path.join(dir, "slices", "record-ping.md"));
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, env: cleanGitEnv() });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "init"]);
  return { repo: dir, modelPath: path.join(dir, "model.em") };
}

describe.skipIf(!hasEm())("--skip-readiness-gate (#15)", () => {
  it("default: a non-ready slice is still refused and nothing is allocated", () => {
    const { repo, modelPath } = buildScratchRepoWithModel();
    expect(() =>
      runBridge(["record-ping", "--repo-root", repo, "--model", modelPath, "--skip-design-gate"])
    ).toThrow(/not ready to implement/);
    expect(existsSync(path.join(repo, "specs"))).toBe(false);
  });

  it("with the flag: allocates despite the non-ready slice and prints the loud warning", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { repo, modelPath } = buildScratchRepoWithModel();
    const result = runBridge([
      "record-ping",
      "--repo-root",
      repo,
      "--model",
      modelPath,
      "--skip-design-gate",
      "--skip-readiness-gate",
      "--dry-run",
    ]);
    expect(result.branchName).toMatch(/record-ping/);
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/bridge: WARNING --skip-readiness-gate is set/);
    expect(logged).toMatch(/NOT ratified/);
  });

  it("is independent of --skip-design-gate: readiness skipped, design gate still enforced", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { repo, modelPath } = buildScratchRepoWithModel();
    // No typespec/ in the scratch repo, so the design gate must still refuse.
    expect(() =>
      runBridge(["record-ping", "--repo-root", repo, "--model", modelPath, "--skip-readiness-gate"])
    ).toThrow(/No typespec\/main\.tsp found/);
  });

  it("--skip-design-gate alone does not bypass readiness (unchanged)", () => {
    const { repo, modelPath } = buildScratchRepoWithModel();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      runBridge(["record-ping", "--repo-root", repo, "--model", modelPath, "--skip-design-gate"])
    ).toThrow(/not ready to implement/);
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join("\n")).not.toMatch(/skip-readiness-gate/);
  });
});
