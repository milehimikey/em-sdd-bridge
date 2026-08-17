import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
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
// rendering, bundling) unrelated to the design-completeness gate /
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

  it("produces a bundled spec.md for the Automation pattern-pair", () => {
    const result = runBridge([
      "pings-to-notify",
      "send-notification",
      "--repo-root",
      repoRoot,
      "--model",
      modelPath,
      "--dry-run",
      "--skip-design-gate",
    ]);

    expect(result.branchName).toMatch(/^\d{3}-pings-to-notify$/);
    expect(result.content).toContain(
      "**Traceability**: slice key(s) `pings-to-notify`, `send-notification` · pattern `automation`"
    );
  });

  it("refuses more than a pattern-mandated pair", () => {
    expect(() =>
      runBridge([
        "record-ping",
        "recent-pings",
        "pings-to-notify",
        "--repo-root",
        repoRoot,
        "--model",
        modelPath,
        "--dry-run",
        "--skip-design-gate",
      ])
    ).toThrow(/out of scope/);
  });
});
