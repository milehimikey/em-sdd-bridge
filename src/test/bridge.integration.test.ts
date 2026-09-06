import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBridge } from "../bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
// A minimal, self-contained copy of the real installed spec-kit scripts this
// bridge targets (a pinned create-new-feature.sh / common.sh /
// spec-template.md, plus BOTH git-extension branch-script filenames -- the
// current spec-kit name and an older-vintage name -- so allocate-feature.ts's
// dual-layout probe has both to detect; see fixtures/speckit-scripts/README.md),
// standing in for a real `.specify/` checkout so this suite doesn't depend on
// being run from inside one.
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

// End-to-end: real `em export` + the real installed create-new-feature.sh
// (--dry-run, so nothing under the real repo's specs/ or .specify/ is written).
// Skips gracefully in environments without the `em` CLI on PATH.
//
// --skip-design-gate: these tests exercise bridge mechanics (spec.md
// rendering, allocation) unrelated to the design-completeness gate /
// events-first prerequisite. This fixture's component dir has no real
// consumer source tree to search and this environment has no TypeSpec
// compiler installed, so the gate would otherwise always fail here -- see
// src/test/preconditions.test.ts for tests that exercise the gate itself,
// unskipped, without this flag.
describe.skipIf(!hasEm())("runBridge (dry-run, real em + real create-new-feature.sh)", () => {
  it("produces a structurally valid spec.md for a single State Change slice", () => {
    const result = runBridge([
      "record-ping",
      "--repo-root",
      repoRoot,
      "--model",
      modelPath,
      "--dry-run",
      "--skip-design-gate",
    ]);

    expect(result.specFile).toBeNull();
    expect(result.branchName).toMatch(/^\d{3}-record-ping$/);
    expect(result.content).toContain("# Feature Specification: Record Ping");
    expect(result.content).toMatch(/\*\*Feature Branch\*\*: `\d{3}-record-ping`/);
    expect(result.content).toMatch(/\(INV-1\)/);
  });

  it("produces a structurally valid spec.md for the merged Automation slice (reaction + command + event)", () => {
    const result = runBridge([
      "send-notification",
      "--repo-root",
      repoRoot,
      "--model",
      modelPath,
      "--dry-run",
      "--skip-design-gate",
    ]);

    expect(result.branchName).toMatch(/^\d{3}-send-notification$/);
    expect(result.content).toContain("# Feature Specification: Send Notification");
    expect(result.content).toContain(
      "**Traceability**: slice key(s) `send-notification` · pattern `automation`"
    );
  });

  it("refuses more than one slice key, pointing at the merged shape", () => {
    expect(() =>
      runBridge([
        "record-ping",
        "recent-pings",
        "--repo-root",
        repoRoot,
        "--model",
        modelPath,
        "--dry-run",
        "--skip-design-gate",
      ])
    ).toThrow(/merged Automation\/Translation reaction shape/);
  });
});

// Constitution advisory (MIL-203): a copy of the speckit-scripts fixture
// repo, since these tests write into .specify/memory/ and must not mutate
// the shared fixture used by every other test in this file.
const constitutionTmpDirs: string[] = [];
function fixtureRepoWithConstitution(constitutionText: string | undefined): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-constitution-advisory-"));
  constitutionTmpDirs.push(dir);
  cpSync(repoRoot, dir, { recursive: true });
  if (constitutionText !== undefined) {
    const memoryDir = path.join(dir, ".specify", "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(path.join(memoryDir, "constitution.md"), constitutionText, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (constitutionTmpDirs.length) {
    rmSync(constitutionTmpDirs.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe.skipIf(!hasEm())("runBridge constitution advisory (MIL-203)", () => {
  const stockTemplate = `# [PROJECT_NAME] Constitution\n\n## Core Principles\n\n### [PRINCIPLE_1_NAME]\n[PRINCIPLE_1_DESCRIPTION]\n\n## Governance\n\n[GOVERNANCE_RULES]\n\n**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]\n`;
  const filledConstitution = `# Waitlist Service Constitution\n\n## Core Principles\n\n### I. Library-First\nEvery feature starts as a standalone library.\n\n## Governance\n\nAmendments require review.\n\n**Version**: 1.0.0 | **Ratified**: 2026-09-01 | **Last Amended**: 2026-09-01\n`;

  it("prints the warning to stderr and still succeeds, when constitution.md is the unfilled template", () => {
    const withConstitution = fixtureRepoWithConstitution(stockTemplate);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = runBridge([
      "record-ping",
      "--repo-root",
      withConstitution,
      "--model",
      modelPath,
      "--dry-run",
      "--skip-design-gate",
    ]);

    expect(result.branchName).toMatch(/^\d{3}-record-ping$/);
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("bridge: warning: .specify/memory/constitution.md is still spec-kit's unfilled template")
      )
    ).toBe(true);
  });

  it("prints no constitution warning when constitution.md is filled in", () => {
    const withConstitution = fixtureRepoWithConstitution(filledConstitution);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = runBridge([
      "record-ping",
      "--repo-root",
      withConstitution,
      "--model",
      modelPath,
      "--dry-run",
      "--skip-design-gate",
    ]);

    expect(result.branchName).toMatch(/^\d{3}-record-ping$/);
    expect(errorSpy.mock.calls.some((call) => typeof call[0] === "string" && call[0].includes("constitution.md"))).toBe(
      false
    );
  });

  it("prints no constitution warning when constitution.md does not exist at all", () => {
    const withoutConstitution = fixtureRepoWithConstitution(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = runBridge([
      "record-ping",
      "--repo-root",
      withoutConstitution,
      "--model",
      modelPath,
      "--dry-run",
      "--skip-design-gate",
    ]);

    expect(result.branchName).toMatch(/^\d{3}-record-ping$/);
    expect(errorSpy.mock.calls.some((call) => typeof call[0] === "string" && call[0].includes("constitution.md"))).toBe(
      false
    );
  });
});
