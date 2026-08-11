import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSliceDoc, assertReadyToImplement } from "../lib/slice-doc.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures/slices");

function loadFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

describe("parseSliceDoc", () => {
  it("parses a full State Change slice doc", () => {
    const doc = parseSliceDoc(loadFixture("record-ping.md"));
    expect(doc.name).toBe("Record Ping");
    expect(doc.pattern).toBe("State Change");
    expect(doc.status).toBe("ready-to-implement");
    expect(doc.command?.name).toBe("Record Ping");
    expect(doc.command?.fields).toEqual([
      { field: "postedAt", type: "Instant", required: "yes", rules: "Must not be in the future relative to server time." },
      { field: "source", type: "string", required: "yes", rules: "Non-empty; max 200 characters." },
    ]);
    expect(doc.events?.name).toBe("Ping Recorded");
    expect(doc.events?.context).toBe("Pings");
    expect(doc.invariants).toEqual([
      { id: "INV-1", text: "Reject Record Ping when postedAt is in the future." },
    ]);
    expect(doc.scenarios[0].kind).toBe("happy");
    expect(doc.scenarios[1]).toMatchObject({ kind: "rejected", invId: "INV-1" });
    expect(doc.openQuestions).toEqual([
      {
        checked: true,
        text: "Should postedAt default to server-received time if omitted? Resolved: no, it is always required from the caller.",
      },
    ]);
  });

  it("parses a State View slice doc's Read Model / View section", () => {
    const doc = parseSliceDoc(loadFixture("recent-pings.md"));
    expect(doc.pattern).toBe("State View");
    expect(doc.command).toBeNull();
    expect(doc.readModel).toEqual({
      view: "Recent Pings",
      consumedBy: "the Recent Pings View screen",
      freshness: "eventual",
      builtFromEvents: '"Ping Recorded"',
    });
  });

  it("throws when the title heading is missing", () => {
    expect(() => parseSliceDoc("no title here")).toThrow(BridgeError);
  });
});

describe("assertReadyToImplement", () => {
  it("passes for a ready doc with no unchecked Open Questions", () => {
    const doc = parseSliceDoc(loadFixture("record-ping.md"));
    expect(() => assertReadyToImplement(doc, "record-ping.md")).not.toThrow();
  });

  it("refuses a doc that is not Status: ready-to-implement", () => {
    const doc = parseSliceDoc(loadFixture("not-ready.md"));
    expect(() => assertReadyToImplement(doc, "not-ready.md")).toThrow(/not "ready-to-implement"/);
  });

  it("refuses a doc with an unchecked Open Question", () => {
    const doc = parseSliceDoc(loadFixture("open-question.md"));
    expect(() => assertReadyToImplement(doc, "open-question.md")).toThrow(/unchecked Open Question/);
  });
});
