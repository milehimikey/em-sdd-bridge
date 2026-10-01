import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cleanGitEnv } from "../lib/clean-git-env.js";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allocateFeature, coreScriptCreatesGitBranch } from "../lib/allocate-feature.js";
import { runBridge } from "../bridge.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
// Source of the REAL installed spec-kit scripts (this suite never edits or
// reimplements them -- it copies them into disposable scratch repos to
// exercise allocation against a throwaway git history). Same fixture
// bridge.integration.test.ts uses -- see fixtures/speckit-scripts/README.md.
const repoRoot = path.join(fixturesDir, "speckit-scripts");
const modelPath = path.join(fixturesDir, "model.em");

function hasEm(): boolean {
  try {
    execFileSync("em", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(args: string[], cwd: string): string {
  // cleanGitEnv: without this, running these tests from inside a git hook
  // (e.g. a pre-commit vitest run) makes every one of these commands operate
  // on the HOST repo via hook-exported GIT_DIR/GIT_INDEX_FILE instead of the
  // scratch repo at `cwd`. Verified destructive in this bridge's originating
  // engagement.
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
 * Build a disposable git repo with the installed spec-kit scripts copied in
 * (core create-new-feature.sh always), so allocation can be exercised
 * against a throwaway history -- never the real checkout.
 *
 * `extension` controls which git-extension branch-creation script layout (if
 * any) is copied in, exercising `allocate-feature.ts`'s dual-layout probe:
 *   - "current": ONLY the current spec-kit filename, `create-new-feature.sh`
 *     (same basename as the core script, disambiguated by directory).
 *   - "legacy": ONLY the older-vintage filename, `create-new-feature-branch.sh`
 *     (kept in the fixture specifically to exercise the fallback -- see
 *     fixtures/speckit-scripts/README.md).
 *   - false: no git extension at all (core-script-only fallback path).
 */
function buildScratchRepo(extension: "current" | "legacy" | false): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-allocate-feature-"));
  scratchDirs.push(dir);

  mkdirSync(path.join(dir, ".specify", "scripts", "bash"), { recursive: true });
  mkdirSync(path.join(dir, ".specify", "templates"), { recursive: true });
  copyFileSync(
    path.join(repoRoot, ".specify", "scripts", "bash", "common.sh"),
    path.join(dir, ".specify", "scripts", "bash", "common.sh")
  );
  copyFileSync(
    path.join(repoRoot, ".specify", "scripts", "bash", "create-new-feature.sh"),
    path.join(dir, ".specify", "scripts", "bash", "create-new-feature.sh")
  );
  chmodSync(path.join(dir, ".specify", "scripts", "bash", "create-new-feature.sh"), 0o755);
  copyFileSync(
    path.join(repoRoot, ".specify", "templates", "spec-template.md"),
    path.join(dir, ".specify", "templates", "spec-template.md")
  );

  if (extension) {
    const extBashDir = path.join(dir, ".specify", "extensions", "git", "scripts", "bash");
    mkdirSync(extBashDir, { recursive: true });
    const branchScriptName = extension === "current" ? "create-new-feature.sh" : "create-new-feature-branch.sh";
    for (const file of [branchScriptName, "git-common.sh"]) {
      const src = path.join(repoRoot, ".specify", "extensions", "git", "scripts", "bash", file);
      if (!existsSync(src)) continue;
      const dest = path.join(extBashDir, file);
      copyFileSync(src, dest);
      chmodSync(dest, 0o755);
    }
  }

  // Mirror a repo-wide gitignore of .specify/feature.json so the "written
  // but untracked" assertions below mean something.
  writeFileSync(path.join(dir, ".gitignore"), ".specify/feature.json\n");

  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "init"], dir);

  return dir;
}

/**
 * Rewrites the scratch repo's core create-new-feature.sh into a DERIVED
 * git-capable variant (#14): a copy of the pinned core with a branch-creation
 * block added that mirrors the issue's description. The fixture itself is never
 * edited; only the scratch copy is. Committed so the tree stays clean.
 */
function makeCoreGitCapable(repo: string): string {
  const script = path.join(repo, ".specify", "scripts", "bash", "create-new-feature.sh");
  const anchor = 'if [ "$DRY_RUN" != true ]; then\n    if [ -d "$FEATURE_DIR" ]';
  const gitBlock = [
    'if [ "$DRY_RUN" != true ]; then',
    '    if git rev-parse --verify --quiet "refs/heads/$BRANCH_NAME" >/dev/null 2>&1; then',
    '        if [ "$ALLOW_EXISTING" = true ]; then',
    '            git checkout -q "$BRANCH_NAME"',
    '        else',
    `            echo "Error: Branch '$BRANCH_NAME' already exists. Please use a different feature name or specify a different number with --number." >&2`,
    '            exit 1',
    '        fi',
    '    else',
    '        git checkout -q -b "$BRANCH_NAME"',
    '    fi',
    'fi',
    '',
    '',
  ].join("\n");
  const original = readFileSync(script, "utf8");
  expect(original).toContain(anchor);
  writeFileSync(script, original.replace(anchor, gitBlock + anchor));
  git(["commit", "-q", "-am", "derive git-capable core"], repo);
  return script;
}

describe("allocateFeature (git extension present via current spec-kit filename, real scratch git repo)", () => {
  it("creates and checks out the branch, then aligns the spec dir to the SAME number", () => {
    const repo = buildScratchRepo("current");

    const allocated = allocateFeature({
      repoRoot: repo,
      shortName: "widget-thing",
      description: "Add the widget thing",
    });

    expect(allocated.branchName).toMatch(/^\d{3}-widget-thing$/);
    expect(path.basename(path.dirname(allocated.specFile))).toBe(allocated.branchName);

    const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], repo);
    expect(currentBranch).toBe(allocated.branchName);

    const specDir = path.join(repo, "specs", allocated.branchName);
    expect(existsSync(specDir)).toBe(true);
    expect(existsSync(allocated.specFile)).toBe(true);
  });

  it("--dry-run creates no branch, no specs dir, and no feature.json", () => {
    const repo = buildScratchRepo("current");
    const startingBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], repo);

    const allocated = allocateFeature({
      repoRoot: repo,
      shortName: "dry-run-thing",
      description: "Add the dry run thing",
      dryRun: true,
    });

    expect(allocated.branchName).toMatch(/^\d{3}-dry-run-thing$/);

    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).toBe(startingBranch);
    expect(git(["branch", "--list", allocated.branchName], repo)).toBe("");
    expect(existsSync(path.join(repo, "specs"))).toBe(false);
    expect(existsSync(path.join(repo, ".specify", "feature.json"))).toBe(false);
  });

  it("writes .specify/feature.json but leaves it untracked (gitignored, not staged)", () => {
    const repo = buildScratchRepo("current");

    allocateFeature({
      repoRoot: repo,
      shortName: "feature-json-thing",
      description: "Add the feature json thing",
    });

    const featureJsonPath = path.join(repo, ".specify", "feature.json");
    expect(existsSync(featureJsonPath)).toBe(true);
    expect(JSON.parse(readFileSync(featureJsonPath, "utf8")).feature_directory).toMatch(
      /^specs\/\d{3}-feature-json-thing$/
    );

    // Ignored by .gitignore, so `git status --porcelain` says nothing about it.
    const status = git(["status", "--porcelain"], repo);
    expect(status).not.toContain("feature.json");
    // And explicitly confirmed ignored, not merely "not yet git add-ed".
    expect(() => git(["check-ignore", "-q", ".specify/feature.json"], repo)).not.toThrow();
  });

});

describe("allocateFeature (git extension present via legacy filename, real scratch git repo)", () => {
  it("still detects the extension and allocates + checks out the branch (dual-layout probe fallback)", () => {
    const repo = buildScratchRepo("legacy");
    // Confirm the fixture really only has the legacy name here -- otherwise
    // this test would pass even if the fallback branch of
    // gitExtensionBranchScriptPath() were broken.
    expect(
      existsSync(path.join(repo, ".specify", "extensions", "git", "scripts", "bash", "create-new-feature.sh"))
    ).toBe(false);
    expect(
      existsSync(
        path.join(repo, ".specify", "extensions", "git", "scripts", "bash", "create-new-feature-branch.sh")
      )
    ).toBe(true);

    const allocated = allocateFeature({
      repoRoot: repo,
      shortName: "legacy-name-thing",
      description: "Add the legacy name thing",
    });

    expect(allocated.branchName).toMatch(/^\d{3}-legacy-name-thing$/);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).toBe(allocated.branchName);
    expect(existsSync(path.join(repo, "specs", allocated.branchName))).toBe(true);
  });

  it("fails loudly instead of silently pairing a mismatched branch/spec-dir name", () => {
    const repo = buildScratchRepo("legacy");

    // Force a deterministic divergence: the LEGACY extension script supports
    // a git-config.yml `branch_template` (e.g. for monorepo namespacing) that
    // the core script has no equivalent for -- it always names the spec dir
    // "{number}-{slug}". With a template configured, the extension's branch
    // and the core script's spec dir share the SAME --number but land on
    // DIFFERENT names, which is exactly the case the mismatch check exists
    // to catch loudly instead of silently pairing the wrong branch/dir (the
    // same check also covers the genuine-race case, which isn't
    // deterministically reproducible from a single synchronous call).
    // NOTE: the current spec-kit script layout dropped
    // branch_template/branch_prefix support entirely, so forcing this
    // divergence deterministically now requires the legacy script -- the
    // mismatch-detection logic under test lives in allocate-feature.ts
    // itself and is exercised identically regardless of which script name
    // triggered it.
    mkdirSync(path.join(repo, ".specify", "extensions", "git"), { recursive: true });
    writeFileSync(
      path.join(repo, ".specify", "extensions", "git", "git-config.yml"),
      'branch_template: "custom/{number}-{slug}"\n'
    );

    expect(() =>
      allocateFeature({
        repoRoot: repo,
        shortName: "colliding-thing",
        description: "Add the colliding thing",
      })
    ).toThrow(BridgeError);
    expect(() =>
      allocateFeature({
        repoRoot: repo,
        shortName: "colliding-thing-2",
        description: "Add the colliding thing 2",
      })
    ).toThrow(/branch\/spec-dir name mismatch/);
  });
});

describe("coreScriptCreatesGitBranch (static probe, #14)", () => {
  it("is false for the pinned core script (does not touch git)", () => {
    expect(coreScriptCreatesGitBranch(path.join(repoRoot, ".specify", "scripts", "bash", "create-new-feature.sh"))).toBe(
      false
    );
  });

  it("is true for a derived core that runs `git checkout -q -b`", () => {
    const repo = buildScratchRepo("current");
    expect(coreScriptCreatesGitBranch(makeCoreGitCapable(repo))).toBe(true);
  });

  it("recognises `git switch -c` and `git branch <name>`, ignores comments and non-creating git calls, and is false for a missing file", () => {
    const repo = buildScratchRepo(false);
    const probe = (body: string): boolean => {
      const f = path.join(repo, "probe.sh");
      writeFileSync(f, body);
      return coreScriptCreatesGitBranch(f);
    };
    expect(probe('git switch -c "$BRANCH_NAME"\n')).toBe(true);
    expect(probe('git branch "$BRANCH_NAME"\n')).toBe(true);
    expect(probe('# git checkout -b "$BRANCH_NAME"\n')).toBe(false);
    expect(probe('git rev-parse --git-dir\ngit branch --list\ngit checkout main\n')).toBe(false);
    expect(coreScriptCreatesGitBranch(path.join(repo, "nope.sh"))).toBe(false);
  });
});

describe("allocateFeature (extension + git-capable core, #14)", () => {
  it("reproduces: without --allow-existing-branch the derived core fails 'already exists' after the extension created the branch", () => {
    const repo = buildScratchRepo("current");
    const core = makeCoreGitCapable(repo);
    const ext = path.join(repo, ".specify", "extensions", "git", "scripts", "bash", "create-new-feature.sh");
    const run = (script: string, args: string[]): string =>
      execFileSync(script, args, { cwd: repo, encoding: "utf8", env: cleanGitEnv(), stdio: ["ignore", "pipe", "pipe"] });

    const branch = JSON.parse(run(ext, ["--json", "--short-name", "edit-debt", "Edit debt"]));
    expect(() =>
      run(core, ["--json", "--short-name", "edit-debt", "--number", branch.FEATURE_NUM, "Edit debt"])
    ).toThrow(/already exists/);
  });

  it("real (non-dry-run) allocation succeeds: branch checked out, spec dir aligned", () => {
    const repo = buildScratchRepo("current");
    makeCoreGitCapable(repo);

    const allocated = allocateFeature({
      repoRoot: repo,
      shortName: "edit-debt",
      description: "Edit debt",
    });

    expect(allocated.branchName).toMatch(/^\d{3}-edit-debt$/);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).toBe(allocated.branchName);
    expect(path.basename(path.dirname(allocated.specFile))).toBe(allocated.branchName);
    expect(existsSync(allocated.specFile)).toBe(true);
    expect(git(["branch", "--list", allocated.branchName], repo)).toContain(allocated.branchName);
  });

  it("--dry-run still works and creates nothing", () => {
    const repo = buildScratchRepo("current");
    makeCoreGitCapable(repo);
    const allocated = allocateFeature({ repoRoot: repo, shortName: "edit-debt", description: "Edit debt", dryRun: true });
    expect(git(["branch", "--list", allocated.branchName], repo)).toBe("");
    expect(existsSync(path.join(repo, "specs"))).toBe(false);
  });
});

describe("allocateFeature (git extension absent -> core-script-only fallback)", () => {
  it("still allocates a spec dir/number, but creates no git branch", () => {
    const repo = buildScratchRepo(false);
    expect(existsSync(path.join(repo, ".specify", "extensions"))).toBe(false);
    const startingBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], repo);

    const allocated = allocateFeature({
      repoRoot: repo,
      shortName: "fallback-thing",
      description: "Add the fallback thing",
    });

    expect(allocated.branchName).toMatch(/^\d{3}-fallback-thing$/);
    expect(existsSync(allocated.specFile)).toBe(true);

    // No git extension installed -> no branch is created or checked out.
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).toBe(startingBranch);
    expect(git(["branch", "--list", allocated.branchName], repo)).toBe("");
  });
});

describe("allocateFeature (spec-kit scaffold script missing)", () => {
  it("throws a BridgeError naming the expected script path and the spec-kit-init remedy, not a raw ENOENT", () => {
    // A repo with a `.specify/` dir (so repo-root detection succeeds) but
    // none of the scaffold scripts underneath it -- e.g. `specify init` was
    // never run, or was interrupted partway through. Deliberately doesn't
    // reuse buildScratchRepo(), which always copies create-new-feature.sh in.
    const dir = mkdtempSync(path.join(tmpdir(), "bridge-allocate-feature-no-scaffold-"));
    scratchDirs.push(dir);
    mkdirSync(path.join(dir, ".specify"), { recursive: true });
    git(["init", "-q", "-b", "main"], dir);
    git(["config", "user.email", "test@example.com"], dir);
    git(["config", "user.name", "Test"], dir);
    writeFileSync(path.join(dir, "README.md"), "placeholder\n");
    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "init"], dir);

    const expectedScript = path.join(dir, ".specify", "scripts", "bash", "create-new-feature.sh");
    expect(existsSync(expectedScript)).toBe(false);

    const allocate = () =>
      allocateFeature({
        repoRoot: dir,
        shortName: "no-scaffold-thing",
        description: "Add the no scaffold thing",
      });

    expect(allocate).toThrow(BridgeError);
    expect(allocate).toThrow(expectedScript);
    expect(allocate).toThrow(/spec-kit init/);
  });
});

// End-to-end through the actual bridge.ts entrypoint (runBridge), proving a
// SINGLE invocation produces branch + spec dir + spec.md + feature.json,
// race-free, against a real (scratch) git repo with the git extension
// installed. Skips gracefully without the `em` CLI on PATH, matching
// bridge.integration.test.ts.
//
// --skip-design-gate: these tests exercise allocation mechanics, not the
// design-completeness gate / events-first prerequisite -- the scratch repo
// built above has no consumer source tree to search and no TypeSpec compiler
// is installed in this environment, so the gate would otherwise always fail
// here. See src/test/preconditions.test.ts (which exercises the gate itself,
// unskipped).
describe.skipIf(!hasEm())("runBridge (git extension present, real em + real scratch git repo)", () => {
  it("single invocation: branch exists + checked out, spec dir number == branch number, spec.md written, feature.json written-but-untracked", () => {
    const repo = buildScratchRepo("current");

    const result = runBridge(["record-ping", "--repo-root", repo, "--model", modelPath, "--skip-design-gate"]);

    expect(result.branchName).toMatch(/^\d{3}-record-ping$/);
    expect(result.specFile).not.toBeNull();

    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).toBe(result.branchName);

    const specDirName = path.basename(path.dirname(result.specFile!));
    expect(specDirName).toBe(result.branchName);

    const writtenContent = readFileSync(result.specFile!, "utf8");
    expect(writtenContent).toBe(result.content);
    expect(writtenContent).toContain("# Feature Specification: Record Ping");

    const featureJsonPath = path.join(repo, ".specify", "feature.json");
    expect(existsSync(featureJsonPath)).toBe(true);
    expect(git(["status", "--porcelain"], repo)).not.toContain("feature.json");
  });

  it("--dry-run leaves no branch, no specs dir, no feature.json", () => {
    const repo = buildScratchRepo("current");
    const startingBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], repo);

    const result = runBridge([
      "record-ping",
      "--repo-root",
      repo,
      "--model",
      modelPath,
      "--dry-run",
      "--skip-design-gate",
    ]);

    expect(result.specFile).toBeNull();
    expect(result.branchName).toMatch(/^\d{3}-record-ping$/);

    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).toBe(startingBranch);
    expect(existsSync(path.join(repo, "specs"))).toBe(false);
    expect(existsSync(path.join(repo, ".specify", "feature.json"))).toBe(false);
  });
});
