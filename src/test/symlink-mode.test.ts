import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBridge } from "../bridge.js";
import { cleanGitEnv } from "../lib/clean-git-env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
const fixtureRepoRoot = path.join(fixturesDir, "speckit-scripts");
const fixtureModelPath = path.join(fixturesDir, "model.em");

function hasEm(): boolean {
  try {
    execFileSync("em", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(args: string[], cwd: string): string {
  // cleanGitEnv: see allocate-feature.test.ts -- without it, a hook-invoked
  // vitest run operates on the HOST repo instead of the scratch repo.
  return execFileSync("git", args, { cwd, encoding: "utf8", env: cleanGitEnv() }).trim();
}

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length) {
    const dir = scratchDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A disposable git repo with the real spec-kit scripts AND the em fixture
 * model + slice docs copied in, so --symlink's real (non-dry-run) path can
 * create an actual link inside a throwaway tree and we can assert on it.
 * Model at repo root, slice docs under slices/ -- mirroring the fixture
 * layout so `note "slices/<name>.md"` bindings keep resolving.
 */
function buildScratchRepoWithModel(): { repo: string; modelPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-symlink-mode-"));
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

  // Git extension (current filename) so allocation also creates the branch --
  // the closest shape to a real consuming repo.
  const extBash = [".specify", "extensions", "git", "scripts", "bash"];
  mkdirSync(path.join(dir, ...extBash), { recursive: true });
  for (const file of ["create-new-feature.sh", "git-common.sh"]) {
    const src = path.join(fixtureRepoRoot, ...extBash, file);
    if (!existsSync(src)) continue;
    const dest = path.join(dir, ...extBash, file);
    copyFileSync(src, dest);
    chmodSync(dest, 0o755);
  }

  copyFileSync(fixtureModelPath, path.join(dir, "model.em"));
  cpSync(path.join(fixturesDir, "slices"), path.join(dir, "slices"), { recursive: true });

  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);

  return { repo: dir, modelPath: path.join(dir, "model.em") };
}

describe.skipIf(!hasEm())("--symlink mode (redirection: spec.md is a link to the slice doc)", () => {
  it("real run: replaces the template spec.md with a relative symlink resolving to the slice doc", () => {
    const { repo, modelPath } = buildScratchRepoWithModel();

    const result = runBridge([
      "record-ping",
      "--repo-root",
      repo,
      "--model",
      modelPath,
      "--symlink",
      "--skip-design-gate",
    ]);

    expect(result.mode).toBe("symlink");
    expect(result.specFile).not.toBeNull();
    const specFile = result.specFile!;

    // It IS a symlink (i.e. the template copy was replaced, not appended to)...
    expect(lstatSync(specFile).isSymbolicLink()).toBe(true);
    // ...whose stored target is relative (survives clones/worktrees/moves)...
    const storedTarget = readlinkSync(specFile);
    expect(path.isAbsolute(storedTarget)).toBe(false);
    expect(storedTarget).toBe(result.symlinkTarget);
    // ...and which resolves to the ratified slice doc itself.
    expect(realpathSync(specFile)).toBe(realpathSync(path.join(repo, "slices", "record-ping.md")));

    // The shell layer's contract holds: reading through the link yields the
    // slice doc, so `[[ -f spec.md ]]` + prompt reads of FEATURE_SPEC both work.
    expect(readFileSync(specFile, "utf8")).toContain("# Slice: Record Ping");

    // The Traceability line has no rendered file to live in -- it comes back
    // as the content, for the PR description.
    expect(result.content).toContain("**Traceability**: slice key(s) `record-ping`");

    // Allocation still did its whole job: numbered branch created + checked out.
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).toBe(result.branchName);
    expect(result.branchName).toMatch(/^\d{3}-record-ping$/);
  });

  it("dry-run: creates nothing, reports the would-be target and the traceability line", () => {
    const result = runBridge([
      "record-ping",
      "--repo-root",
      fixtureRepoRoot,
      "--model",
      fixtureModelPath,
      "--symlink",
      "--dry-run",
      "--skip-design-gate",
    ]);

    expect(result.mode).toBe("symlink");
    expect(result.specFile).toBeNull();
    expect(result.symlinkTarget).toBeDefined();
    expect(path.isAbsolute(result.symlinkTarget!)).toBe(false);
    // From specs/NNN-slug/ the link must climb out of the spec dir to reach
    // the slice doc.
    expect(result.symlinkTarget).toMatch(/^(\.\.[/\\])+.*record-ping\.md$/);
    expect(result.content).toContain("**Traceability**");
    expect(result.content).not.toContain("# Feature Specification");
  });

  it("refuses two slice keys under --symlink too: one slice key per invocation, no exception", () => {
    expect(() =>
      runBridge([
        "record-ping",
        "recent-pings",
        "--repo-root",
        fixtureRepoRoot,
        "--model",
        fixtureModelPath,
        "--symlink",
        "--dry-run",
        "--skip-design-gate",
      ])
    ).toThrow(/exactly one slice key/);
  });

  it("still enforces the readiness gate: a non-ready slice does not get linked", () => {
    const { repo, modelPath } = buildScratchRepoWithModel();

    // Readiness is now fully delegated to `em validate --slice-ready`, which
    // always evaluates the MODEL's own note-bound doc for the key -- --doc no
    // longer has any influence on it (see bridge.ts's docOverride comment).
    // So exercising the refusal path means making the actual convention-bound
    // doc (slices/record-ping.md) not ready, not pointing --doc elsewhere.
    copyFileSync(path.join(fixturesDir, "slices", "not-ready.md"), path.join(repo, "slices", "record-ping.md"));

    expect(() =>
      runBridge(["record-ping", "--repo-root", repo, "--model", modelPath, "--symlink", "--skip-design-gate"])
    ).toThrow(/not ready to implement/);
    // And nothing was allocated for it (the gate runs before allocation).
    expect(existsSync(path.join(repo, "specs"))).toBe(false);
  });
});
