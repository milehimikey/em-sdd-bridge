import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSliceDoc } from "../lib/slice-doc.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures/slices");

function loadFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

describe("parseSliceDoc", () => {
  it("parses a full State Change slice doc's body content", () => {
    const doc = parseSliceDoc(loadFixture("record-ping.md"), "state-change");
    expect(doc.name).toBe("Record Ping");
    expect(doc.pattern).toBe("state-change");
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
    const doc = parseSliceDoc(loadFixture("recent-pings.md"), "state-view");
    expect(doc.pattern).toBe("state-view");
    expect(doc.command).toBeNull();
    expect(doc.readModel).toEqual({
      view: "Recent Pings",
      consumedBy: "the Recent Pings View screen",
      freshness: "eventual",
      builtFromEvents: '"Ping Recorded"',
    });
  });

  it("echoes back whatever pattern the caller supplies -- it is a parameter, not parsed content", () => {
    const doc = parseSliceDoc(loadFixture("recent-pings.md"), "automation");
    expect(doc.pattern).toBe("automation");
  });

  it("throws when the title heading is missing", () => {
    expect(() => parseSliceDoc("no title here", "state-change")).toThrow(BridgeError);
  });

  it("still parses Open Questions from the body -- unaffected by frontmatter retirement, needed for spec-builder's [NEEDS CLARIFICATION] rendering", () => {
    const doc = parseSliceDoc(loadFixture("open-question.md"), "state-change");
    expect(doc.openQuestions).toEqual([
      { checked: true, text: "This one is resolved." },
      { checked: false, text: "This one is not -- the bridge must refuse." },
    ]);
  });
});
