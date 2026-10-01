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
  symlinkSync,
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
function buildScratchRepoWithModel(designDir = ""): { repo: string; modelPath: string } {
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

  // designDir "" = model at repo root; otherwise a nested design dir, so the
  // relative link has to cross directories (specs/NNN-x/ -> design/...).
  const modelDir = path.join(dir, designDir);
  mkdirSync(modelDir, { recursive: true });
  copyFileSync(fixtureModelPath, path.join(modelDir, "model.em"));
  cpSync(path.join(fixturesDir, "slices"), path.join(modelDir, "slices"), { recursive: true });

  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);

  return { repo: dir, modelPath: path.join(modelDir, "model.em") };
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

  describe("realistic layout, downstream read-through, worktrees, re-run (#18)", () => {
    const nested = path.join("design", "event-model");

    /** Scratch repo with symlink-free paths (macOS tmpdir is /var -> /private/var). */
    function buildResolved(designDir: string): { repo: string; modelPath: string } {
      const b = buildScratchRepoWithModel(designDir);
      return { repo: realpathSync(b.repo), modelPath: realpathSync(b.modelPath) };
    }

    function bash(script: string, cwd: string): string {
      return execFileSync("bash", ["-c", script], { cwd, encoding: "utf8", env: cleanGitEnv() }).trim();
    }

    function linkSlice(repo: string, modelPath: string, key = "record-ping") {
      return runBridge([key, "--repo-root", repo, "--model", modelPath, "--symlink", "--skip-design-gate"]);
    }

    it("nested design dir: link crosses directories, is relative, and resolves to the slice doc", () => {
      const { repo, modelPath } = buildResolved(nested);
      const result = linkSlice(repo, modelPath);
      const specFile = result.specFile!;
      const sliceDoc = path.join(repo, nested, "slices", "record-ping.md");

      expect(lstatSync(specFile).isSymbolicLink()).toBe(true);
      const stored = readlinkSync(specFile);
      expect(path.isAbsolute(stored)).toBe(false);
      // specs/NNN-slug/spec.md -> ../../design/event-model/slices/record-ping.md
      expect(stored).toBe(path.join("..", "..", nested, "slices", "record-ping.md"));
      expect(realpathSync(specFile)).toBe(realpathSync(sliceDoc));
      expect(readFileSync(specFile, "utf8")).toBe(readFileSync(sliceDoc, "utf8"));
    });

    // GAP: when --repo-root is reached through a symlinked path (macOS /tmp and
    // /var, or a symlinked home/workspace), the allocation scripts report the
    // physical spec path while the slice doc path stays as given, so
    // path.relative() climbs to / and back down through the *main checkout's*
    // absolute path. The link is "relative" but not portable: in a worktree or
    // clone it silently resolves back into the original tree. Flip to a plain
    // `it` once bridge.ts realpaths both sides.
    it.fails("repo-root given via a symlinked path: link target stays repo-relative (GAP)", () => {
      const { repo } = buildResolved(nested);
      const aliasParent = mkdtempSync(path.join(tmpdir(), "bridge-symlink-alias-"));
      scratchDirs.push(aliasParent);
      const alias = path.join(aliasParent, "alias");
      symlinkSync(repo, alias);

      const result = linkSlice(alias, path.join(alias, nested, "model.em"));
      expect(readlinkSync(result.specFile!)).toBe(path.join("..", "..", nested, "slices", "record-ping.md"));
    });

    it("downstream shell steps read through the link: -f, cat, and common.sh FEATURE_SPEC", () => {
      const { repo, modelPath } = buildResolved(nested);
      const result = linkSlice(repo, modelPath);
      const featureDir = path.dirname(result.specFile!);
      const sliceDoc = path.join(repo, nested, "slices", "record-ping.md");

      expect(bash("[[ -f spec.md ]] && echo yes", featureDir)).toBe("yes");
      expect(bash("[[ -s spec.md ]] && echo yes", featureDir)).toBe("yes");
      expect(bash("cat spec.md", featureDir)).toBe(readFileSync(sliceDoc, "utf8").trim());

      // common.sh as spec-kit's own phase scripts use it: feature.json (written
      // by the core allocation script) -> get_feature_paths -> FEATURE_SPEC.
      const paths = bash(
        `source .specify/scripts/bash/common.sh && eval "$(get_feature_paths --no-persist)" && ` +
          `[[ -f "$FEATURE_SPEC" ]] && echo "$FEATURE_SPEC" && cat "$FEATURE_SPEC"`,
        repo
      );
      const [featureSpec, ...body] = paths.split("\n");
      expect(realpathSync(featureSpec)).toBe(realpathSync(result.specFile!));
      expect(body.join("\n")).toContain("# Slice: Record Ping");
    });

    it("git worktree: the committed link still resolves in a second checkout", () => {
      const { repo, modelPath } = buildResolved(nested);
      const result = linkSlice(repo, modelPath);
      const rel = path.relative(repo, result.specFile!);
      expect(rel.startsWith("..")).toBe(false);
      git(["add", "-A"], repo);
      git(["commit", "-q", "-m", "linked"], repo);
      // git stores the link as a symlink blob (mode 120000), not a copy.
      expect(git(["ls-files", "-s", rel], repo)).toMatch(/^120000 /);

      const wtParent = mkdtempSync(path.join(tmpdir(), "bridge-symlink-wt-"));
      scratchDirs.push(wtParent);
      const wt = path.join(wtParent, "wt");
      try {
        git(["worktree", "add", "--detach", wt], repo);
        const wtSpec = path.join(wt, rel);
        expect(lstatSync(wtSpec).isSymbolicLink()).toBe(true);
        expect(readlinkSync(wtSpec)).toBe(result.symlinkTarget);
        // Resolves INSIDE the worktree, not back into the main checkout.
        const resolved = realpathSync(wtSpec);
        expect(resolved).toBe(realpathSync(path.join(wt, nested, "slices", "record-ping.md")));
        expect(resolved.startsWith(realpathSync(wt))).toBe(true);
        expect(readFileSync(wtSpec, "utf8")).toContain("# Slice: Record Ping");
      } finally {
        git(["worktree", "remove", "--force", wt], repo);
      }
    });

    it("git worktree: running the bridge from inside a worktree links within that worktree", () => {
      const { repo } = buildResolved(nested);
      const wtParent = mkdtempSync(path.join(tmpdir(), "bridge-symlink-wt-"));
      scratchDirs.push(wtParent);
      const wt = path.join(wtParent, "wt");
      git(["worktree", "add", "-q", "-b", "wt-branch", wt], repo);
      try {
        const result = linkSlice(wt, path.join(wt, nested, "model.em"));
        const specFile = result.specFile!;
        expect(realpathSync(specFile).startsWith(realpathSync(wt))).toBe(true);
        expect(lstatSync(specFile).isSymbolicLink()).toBe(true);
        expect(path.isAbsolute(readlinkSync(specFile))).toBe(false);
        expect(realpathSync(specFile)).toBe(realpathSync(path.join(wt, nested, "slices", "record-ping.md")));
        expect(git(["rev-parse", "--abbrev-ref", "HEAD"], wt)).toBe(result.branchName);
        // Main checkout untouched.
        expect(existsSync(path.join(repo, "specs"))).toBe(false);
      } finally {
        git(["worktree", "remove", "--force", wt], repo);
      }
    });

    it("re-run for the same slice: first feature's link is neither clobbered nor broken", () => {
      const { repo, modelPath } = buildResolved(nested);
      const first = linkSlice(repo, modelPath);
      const firstTarget = readlinkSync(first.specFile!);
      const sliceDoc = path.join(repo, nested, "slices", "record-ping.md");

      // Observed behaviour (recorded, not prescribed): the bridge does not
      // detect the existing feature; it allocates a NEW number and links that.
      // If this starts throwing instead, that is also a non-clobbering outcome.
      let second: ReturnType<typeof linkSlice> | undefined;
      let error: unknown;
      try {
        second = linkSlice(repo, modelPath);
      } catch (e) {
        error = e;
      }

      expect(lstatSync(first.specFile!).isSymbolicLink()).toBe(true);
      expect(readlinkSync(first.specFile!)).toBe(firstTarget);
      expect(realpathSync(first.specFile!)).toBe(realpathSync(sliceDoc));

      if (second) {
        expect(second.branchName).not.toBe(first.branchName);
        expect(second.specFile).not.toBe(first.specFile);
        expect(lstatSync(second.specFile!).isSymbolicLink()).toBe(true);
        expect(realpathSync(second.specFile!)).toBe(realpathSync(sliceDoc));
      } else {
        expect(error).toBeDefined();
      }
    });
  });
});
