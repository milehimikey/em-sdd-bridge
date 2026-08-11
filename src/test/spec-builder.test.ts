import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSpecMarkdown } from "../lib/spec-builder.js";
import { parseSliceDoc } from "../lib/slice-doc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
const slicesDir = path.join(fixturesDir, "slices");

function loadDoc(name: string) {
  return parseSliceDoc(readFileSync(path.join(slicesDir, name), "utf8"));
}

describe("buildSpecMarkdown", () => {
  it("renders a single-slice (State Change) spec.md per the mapping contract", () => {
    const primaryDoc = loadDoc("record-ping.md");
    const content = buildSpecMarkdown({
      branchName: "007-record-ping",
      date: "2026-07-27",
      keys: ["record-ping"],
      pattern: primaryDoc.pattern,
      primaryDoc,
      sliceDocRelPaths: ["slices/record-ping.md"],
      modelName: "model.em",
      modelDir: fixturesDir,
    });

    expect(content).toContain("# Feature Specification: Record Ping");
    expect(content).toContain("**Feature Branch**: `007-record-ping`");
    expect(content).toContain("**Created**: 2026-07-27");
    expect(content).toContain("**Status**: Draft");
    // fixtures/ has no parking-lot.md -- the segment is omitted (a
    // sanctioned adaptation; see spec-builder.ts's doc comment).
    expect(content).toContain(
      "**Traceability**: slice key(s) `record-ping` · pattern `State Change` · model `model.em` · " +
        "slice doc(s): `slices/record-ping.md`"
    );
    expect(content).not.toContain("parking-lot");
    expect(content).toContain('**Input**: User description: "' + primaryDoc.intent + '"');

    // INV-1 traceability: FR ends with the literal (INV-1) tag.
    expect(content).toMatch(/- \*\*FR-\d{3}\*\*: System MUST reject Record Ping when postedAt is in the future \(INV-1\)/);

    // Pure State Change slice with no Read Model / View -> Key Entities omitted entirely.
    expect(content).not.toContain("### Key Entities");

    // Acceptance scenarios carried in order, happy path first.
    const happyIdx = content.indexOf("1. **Given** no prior pings");
    const rejectedIdx = content.indexOf("2. **Given** the current server time");
    expect(happyIdx).toBeGreaterThan(-1);
    expect(rejectedIdx).toBeGreaterThan(happyIdx);
  });

  it("renders Key Entities for a State View slice from Read Model / View only", () => {
    const primaryDoc = loadDoc("recent-pings.md");
    const content = buildSpecMarkdown({
      branchName: "008-recent-pings",
      date: "2026-07-27",
      keys: ["recent-pings"],
      pattern: primaryDoc.pattern,
      primaryDoc,
      sliceDocRelPaths: ["slices/recent-pings.md"],
      modelName: "model.em",
      modelDir: fixturesDir,
    });

    expect(content).toContain("### Key Entities");
    expect(content).toContain("- **Recent Pings**:");
    expect(content).toMatch(/System MUST expose `Recent Pings` reflecting "Ping Recorded" with eventual consistency\./);
  });

  it("renders a bundled Automation pair as one spec with interleaved scenarios and FRs", () => {
    const primaryDoc = loadDoc("pings-to-notify.md");
    const secondaryDoc = loadDoc("send-notification.md");
    const content = buildSpecMarkdown({
      branchName: "009-pings-to-notify",
      date: "2026-07-27",
      keys: ["pings-to-notify", "send-notification"],
      pattern: primaryDoc.pattern,
      primaryDoc,
      secondaryDoc,
      sliceDocRelPaths: ["slices/pings-to-notify.md", "slices/send-notification.md"],
      modelName: "model.em",
      modelDir: fixturesDir,
    });

    expect(content).toContain("# Feature Specification: Pings To Notify");
    expect(content).toContain(
      "**Traceability**: slice key(s) `pings-to-notify`, `send-notification` · pattern `Automation`"
    );
    expect(content).toContain(
      "**Independent Test**: Tested as a unit with `Send Notification` — not independently testable per the Automation/Translation bundling rule (see the project's constitution)."
    );
    expect(content).toContain("### User Story 1 - Pings To Notify (Priority: P1)");
    // Only one User Story per the mapping contract's bundling rule.
    expect(content).not.toContain("### User Story 2");

    // Both slices' INV-1s appear, scoped (not merged/renumbered).
    const invMatches = content.match(/\(INV-1\)/g) ?? [];
    expect(invMatches.length).toBe(2);
  });

  // A sanctioned adaptation from an earlier version of this renderer: it
  // always rendered a hardcoded `parking-lot: [parking-lot.md]
  // (../../parking-lot.md)` segment in the Traceability line, producing a
  // dead link for any component dir that doesn't keep a parking-lot.md. The
  // segment is now conditional on that file actually existing relative to
  // the model dir.
  describe("parking-lot Traceability segment (sanctioned adaptation)", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
      }
    });

    it("omits the segment when parking-lot.md does not exist relative to the model dir", () => {
      const primaryDoc = loadDoc("record-ping.md");
      const content = buildSpecMarkdown({
        branchName: "007-record-ping",
        date: "2026-07-27",
        keys: ["record-ping"],
        pattern: primaryDoc.pattern,
        primaryDoc,
        sliceDocRelPaths: ["slices/record-ping.md"],
        modelName: "model.em",
        modelDir: fixturesDir, // fixtures/ has no parking-lot.md
      });
      expect(content).not.toContain("parking-lot");
    });

    it("omits the segment when modelDir is not passed at all", () => {
      const primaryDoc = loadDoc("record-ping.md");
      const content = buildSpecMarkdown({
        branchName: "007-record-ping",
        date: "2026-07-27",
        keys: ["record-ping"],
        pattern: primaryDoc.pattern,
        primaryDoc,
        sliceDocRelPaths: ["slices/record-ping.md"],
        modelName: "model.em",
      });
      expect(content).not.toContain("parking-lot");
    });

    it("includes the segment when parking-lot.md exists relative to the model dir", () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), "bridge-spec-builder-parking-lot-"));
      writeFileSync(path.join(tmpDir, "parking-lot.md"), "# Parking Lot\n");

      const primaryDoc = loadDoc("record-ping.md");
      const content = buildSpecMarkdown({
        branchName: "007-record-ping",
        date: "2026-07-27",
        keys: ["record-ping"],
        pattern: primaryDoc.pattern,
        primaryDoc,
        sliceDocRelPaths: ["slices/record-ping.md"],
        modelName: "model.em",
        modelDir: tmpDir,
      });

      expect(content).toContain(
        "**Traceability**: slice key(s) `record-ping` · pattern `State Change` · model `model.em` · " +
          "parking-lot: [parking-lot.md](../../parking-lot.md) · slice doc(s): `slices/record-ping.md`"
      );
    });

    // The hardcoded `../../parking-lot.md` literal is only correct when the
    // model lives at repo root (specs/NNN-slug/spec.md -> ../../ -> repo
    // root). When the model lives in a component subdirectory, the link
    // must be computed from the actual spec.md location to the actual
    // parking-lot.md location.
    it("computes the real relative link when modelDir is a component subdirectory of the repo root", () => {
      const repoRoot = mkdtempSync(path.join(tmpdir(), "bridge-spec-builder-parking-lot-repo-"));
      tmpDir = repoRoot;
      const componentDir = path.join(repoRoot, "design", "widget");
      mkdirSync(componentDir, { recursive: true });
      writeFileSync(path.join(componentDir, "parking-lot.md"), "# Parking Lot\n");
      const specFilePath = path.join(repoRoot, "specs", "007-record-ping", "spec.md");

      const primaryDoc = loadDoc("record-ping.md");
      const content = buildSpecMarkdown({
        branchName: "007-record-ping",
        date: "2026-07-27",
        keys: ["record-ping"],
        pattern: primaryDoc.pattern,
        primaryDoc,
        sliceDocRelPaths: ["slices/record-ping.md"],
        modelName: "model.em",
        modelDir: componentDir,
        specFilePath,
      });

      expect(content).toContain("parking-lot: [parking-lot.md](../../design/widget/parking-lot.md)");
      // Sanity: NOT the historical repo-root-relative literal, which would be
      // wrong here.
      expect(content).not.toContain("parking-lot: [parking-lot.md](../../parking-lot.md)");
    });
  });
});
