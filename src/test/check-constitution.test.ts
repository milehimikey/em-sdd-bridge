import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectUnfilledConstitution, warnIfConstitutionUnfilled } from "../lib/check-constitution.js";

const STOCK_TEMPLATE = `# [PROJECT_NAME] Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Core Principles

### [PRINCIPLE_1_NAME]
<!-- Example: I. Library-First -->
[PRINCIPLE_1_DESCRIPTION]
<!-- Example: Every feature starts as a standalone library -->

### [PRINCIPLE_2_NAME]
<!-- Example: II. CLI Interface -->
[PRINCIPLE_2_DESCRIPTION]
<!-- Example: Every library exposes functionality via CLI -->

### [PRINCIPLE_3_NAME]
<!-- Example: III. Test-First (NON-NEGOTIABLE) -->
[PRINCIPLE_3_DESCRIPTION]
<!-- Example: TDD mandatory -->

### [PRINCIPLE_4_NAME]
<!-- Example: IV. Integration Testing -->
[PRINCIPLE_4_DESCRIPTION]
<!-- Example: Focus areas requiring integration tests -->

### [PRINCIPLE_5_NAME]
<!-- Example: V. Observability, VI. Versioning & Breaking Changes, VII. Simplicity -->
[PRINCIPLE_5_DESCRIPTION]
<!-- Example: Text I/O ensures debuggability -->

## [SECTION_2_NAME]
<!-- Example: Additional Constraints, Security Requirements, Performance Standards, etc. -->

[SECTION_2_CONTENT]
<!-- Example: Technology stack requirements -->

## [SECTION_3_NAME]
<!-- Example: Development Workflow, Review Process, Quality Gates, etc. -->

[SECTION_3_CONTENT]
<!-- Example: Code review requirements -->

## Governance
<!-- Example: Constitution supersedes all other practices -->

[GOVERNANCE_RULES]
<!-- Example: All PRs/reviews must verify compliance -->

**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->
`;

const FILLED_CONSTITUTION = `# Waitlist Service Constitution

## Core Principles

### I. Library-First
Every feature starts as a standalone library; libraries must be self-contained and independently testable.

### II. CLI Interface
Every library exposes functionality via a CLI. Text in/out: stdin/args -> stdout, errors -> stderr.

### III. Test-First (NON-NEGOTIABLE)
TDD mandatory: tests written, approved, failing, then implemented. Red-Green-Refactor strictly enforced.

### IV. Integration Testing
New library contract tests, contract changes, and shared schemas all require integration tests.

### V. Observability
Structured logging is required everywhere; text I/O keeps the system debuggable.

## Additional Constraints

TypeScript on Node 20+; no runtime dependency on a database in the CLI layer.

## Development Workflow

Every PR requires one review and a green CI run before merge.

## Governance

This constitution supersedes ad hoc practice. Amendments require a written proposal, one
approving reviewer, and a follow-up migration note.

**Version**: 1.0.0 | **Ratified**: 2026-09-01 | **Last Amended**: 2026-09-01
`;

describe("detectUnfilledConstitution", () => {
  it("flags the stock template as unfilled and lists every distinct token, sorted", () => {
    const result = detectUnfilledConstitution(STOCK_TEMPLATE);
    expect(result.unfilled).toBe(true);
    expect(result.tokens).toEqual([
      "[CONSTITUTION_VERSION]",
      "[GOVERNANCE_RULES]",
      "[LAST_AMENDED_DATE]",
      "[PRINCIPLE_1_DESCRIPTION]",
      "[PRINCIPLE_1_NAME]",
      "[PRINCIPLE_2_DESCRIPTION]",
      "[PRINCIPLE_2_NAME]",
      "[PRINCIPLE_3_DESCRIPTION]",
      "[PRINCIPLE_3_NAME]",
      "[PRINCIPLE_4_DESCRIPTION]",
      "[PRINCIPLE_4_NAME]",
      "[PRINCIPLE_5_DESCRIPTION]",
      "[PRINCIPLE_5_NAME]",
      "[PROJECT_NAME]",
      "[RATIFICATION_DATE]",
      "[SECTION_2_CONTENT]",
      "[SECTION_2_NAME]",
      "[SECTION_3_CONTENT]",
      "[SECTION_3_NAME]",
    ]);
  });

  it("treats a fully filled constitution as not unfilled", () => {
    const result = detectUnfilledConstitution(FILLED_CONSTITUTION);
    expect(result.unfilled).toBe(false);
    expect(result.tokens).toEqual([]);
  });

  it("flags a partially filled document, listing only the remaining tokens", () => {
    // Every principle/section filled in except the governance block and the
    // version/ratification footer -- the realistic "got most of the way
    // through, never finished" case.
    const partial = FILLED_CONSTITUTION.replace(
      /## Governance[\s\S]*$/,
      `## Governance

[GOVERNANCE_RULES]

**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]
`
    );
    const result = detectUnfilledConstitution(partial);
    expect(result.unfilled).toBe(true);
    expect(result.tokens).toEqual([
      "[CONSTITUTION_VERSION]",
      "[GOVERNANCE_RULES]",
      "[LAST_AMENDED_DATE]",
      "[RATIFICATION_DATE]",
    ]);
  });

  it("returns an empty, non-unfilled result for empty text", () => {
    expect(detectUnfilledConstitution("")).toEqual({ unfilled: false, tokens: [] });
  });

  it("dedupes a token that appears more than once", () => {
    const result = detectUnfilledConstitution("[PROJECT_NAME] ... later again [PROJECT_NAME]");
    expect(result.tokens).toEqual(["[PROJECT_NAME]"]);
  });
});

describe("warnIfConstitutionUnfilled", () => {
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

  function writeConstitution(repoRoot: string, text: string): void {
    const memoryDir = path.join(repoRoot, ".specify", "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(path.join(memoryDir, "constitution.md"), text, "utf8");
  }

  it("prints exactly one warning line naming the file and the found tokens, for the stock template", () => {
    const repoRoot = mkTmp("check-constitution-unfilled-");
    writeConstitution(repoRoot, STOCK_TEMPLATE);
    const lines: string[] = [];
    warnIfConstitutionUnfilled(repoRoot, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      `bridge: warning: .specify/memory/constitution.md is still spec-kit's unfilled template ` +
        `(found [CONSTITUTION_VERSION], [GOVERNANCE_RULES], [LAST_AMENDED_DATE], ` +
        `[PRINCIPLE_1_DESCRIPTION], [PRINCIPLE_1_NAME], [PRINCIPLE_2_DESCRIPTION], ` +
        `[PRINCIPLE_2_NAME], [PRINCIPLE_3_DESCRIPTION], [PRINCIPLE_3_NAME], ` +
        `[PRINCIPLE_4_DESCRIPTION], [PRINCIPLE_4_NAME], [PRINCIPLE_5_DESCRIPTION], ` +
        `[PRINCIPLE_5_NAME], [PROJECT_NAME], [RATIFICATION_DATE], [SECTION_2_CONTENT], ` +
        `[SECTION_2_NAME], [SECTION_3_CONTENT], [SECTION_3_NAME]) -- /speckit.plan and /speckit.tasks will run ` +
        `against a constitution that governs nothing; fill it in (em >= 1.11: the ` +
        `event-modeling-implement skill's constitution step) or ratify a real one`
    );
  });

  it("prints nothing for a filled constitution", () => {
    const repoRoot = mkTmp("check-constitution-filled-");
    writeConstitution(repoRoot, FILLED_CONSTITUTION);
    const lines: string[] = [];
    warnIfConstitutionUnfilled(repoRoot, (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it("prints nothing when constitution.md does not exist", () => {
    const repoRoot = mkTmp("check-constitution-missing-");
    mkdirSync(path.join(repoRoot, ".specify"), { recursive: true });
    const lines: string[] = [];
    warnIfConstitutionUnfilled(repoRoot, (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it("prints nothing when .specify/ itself does not exist", () => {
    const repoRoot = mkTmp("check-constitution-no-specify-");
    const lines: string[] = [];
    expect(() => warnIfConstitutionUnfilled(repoRoot, (line) => lines.push(line))).not.toThrow();
    expect(lines).toEqual([]);
  });

  it("never throws, even if constitution.md is unreadable as a directory", () => {
    // A pathological case: constitution.md exists as a directory, not a
    // file -- readFileSync throws EISDIR. This must never propagate.
    const repoRoot = mkTmp("check-constitution-is-dir-");
    mkdirSync(path.join(repoRoot, ".specify", "memory", "constitution.md"), { recursive: true });
    const lines: string[] = [];
    expect(() => warnIfConstitutionUnfilled(repoRoot, (line) => lines.push(line))).not.toThrow();
    expect(lines).toEqual([]);
  });

  it("defaults to console.error when no log function is given", () => {
    const repoRoot = mkTmp("check-constitution-default-log-");
    writeConstitution(repoRoot, STOCK_TEMPLATE);
    expect(() => warnIfConstitutionUnfilled(repoRoot)).not.toThrow();
  });
});
