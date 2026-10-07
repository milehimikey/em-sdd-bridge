import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SECTION_ALIASES,
  assertSliceDocComplete,
  mergeSectionAliases,
  missingRequiredSections,
  parseSliceDoc,
} from "../lib/slice-doc.js";
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

  it("throws when the title heading is missing and no fallback name is supplied", () => {
    expect(() => parseSliceDoc("no title here", "state-change")).toThrow(BridgeError);
    expect(() => parseSliceDoc("no title here", "state-change", "slices/x.md", "   ")).toThrow(
      /slices\/x\.md: missing "# Slice: <Name>" \(or "# <Pattern> Slice: <Name>"\) heading/
    );
  });

  // #23: skill-authored docs title themselves `# <Pattern> Slice: <Name>`;
  // every such doc used to be rejected before parsing started.
  describe("title heading forms (#23)", () => {
    const body = loadFixture("record-ping.md");
    const retitle = (title: string) => body.replace(/^# Slice: Record Ping$/m, title);

    it("still parses the plain `# Slice: <Name>` form", () => {
      expect(parseSliceDoc(body, "state-change").name).toBe("Record Ping");
    });

    it.each([
      ["# State View Slice: Provisioners", "Provisioners"],
      ["# State Change Slice: Create Account", "Create Account"],
      ["# Automation Slice: Notify On Ping", "Notify On Ping"],
      ["# Translation Slice: Import Ledger Entry", "Import Ledger Entry"],
      ["#  state change  Slice:   Create Account  ", "Create Account"],
    ])("accepts %s and takes the name without the prefix", (title, expected) => {
      const doc = parseSliceDoc(retitle(title), "state-change");
      expect(doc.name).toBe(expected);
      // The rest of the body still parses -- the title change is isolated.
      expect(doc.command?.name).toBe("Record Ping");
    });

    it("an unknown prefix is NOT a slice title (the bridge never guesses a name)", () => {
      expect(() => parseSliceDoc(retitle("# Saga Slice: Thing"), "state-change")).toThrow(BridgeError);
    });

    it("falls back to the caller-supplied name (em export's slice.name) when the H1 is absent", () => {
      const noTitle = body.replace(/^# Slice: Record Ping$/m, "");
      const doc = parseSliceDoc(noTitle, "state-change", "slices/record-ping.md", "Record Ping");
      expect(doc.name).toBe("Record Ping");
      expect(doc.command?.name).toBe("Record Ping");
    });

    it("prefers the H1 over the fallback when both exist", () => {
      const doc = parseSliceDoc(body, "state-change", "slices/record-ping.md", "Something Else");
      expect(doc.name).toBe("Record Ping");
    });
  });

  it("still parses Open Questions from the body -- unaffected by frontmatter retirement, needed for spec-builder's [NEEDS CLARIFICATION] rendering", () => {
    const doc = parseSliceDoc(loadFixture("open-question.md"), "state-change");
    expect(doc.openQuestions).toEqual([
      { checked: true, text: "This one is resolved." },
      { checked: false, text: "This one is not -- the bridge must refuse." },
    ]);
  });
});

// #24: exact H2 lookups and the INV-<digits> grammar made docs written to
// other templates parse as nearly empty, with no warning.
describe("heading aliases and INV ids (#24)", () => {
  it("a state-view doc with Purpose / Read Trigger / Source Events / Read Model / Invariants / Scenarios headings parses fully", () => {
    const doc = parseSliceDoc(loadFixture("provisioners-alt-headings.md"), "state-view");
    expect(doc.name).toBe("Provisioners");
    expect(doc.intent).toMatch(/^Let an Operator see every provisioner/);
    expect(doc.triggerActor).toMatch(/^The Operator opens the Provisioners screen/);
    expect(doc.readModel).toEqual({
      view: "Provisioners",
      consumedBy: "the Provisioners screen and the Stale Provisioner Sweep automation",
      freshness: "eventual",
      builtFromEvents: "Provisioner Registered, Provisioner Heartbeat Received, Provisioner Retired",
    });
    expect(doc.invariants).toEqual([
      { id: "INV-EO-1", text: "A retired provisioner never appears in the list." },
      { id: "INV-ACCT-19", text: "Heartbeats older than 5 minutes mark the provisioner stale." },
    ]);
    expect(doc.scenarios.map((s) => [s.kind, s.invId])).toEqual([
      ["happy", undefined],
      ["rejected", "INV-EO-1"],
      ["edge", undefined],
    ]);
    expect(doc.alternateErrorFlows).toEqual(["No provisioners registered yet: the list renders empty."]);
    expect(doc.nonFunctional.security).toBe("Operators only.");
    expect(doc.openQuestions).toEqual([{ checked: true, text: "Should retired provisioners be shown greyed out instead? Resolved: no." }]);
    expect(missingRequiredSections(doc)).toEqual([]);
  });

  it("heading matching ignores case, surrounding whitespace, and a trailing colon", () => {
    const md = ["# Slice: X", "##   intent :", "Some intent.", "## SCENARIOS (given/when/then)", "- **Happy path** — Given a, When b, Then c."].join("\n");
    const doc = parseSliceDoc(md, "state-view");
    expect(doc.intent).toBe("Some intent.");
    expect(doc.scenarios).toHaveLength(1);
  });

  it("HTML comments are not content: the template's `<!-- none -->` markers parse as empty", () => {
    const doc = parseSliceDoc(loadFixture("recent-pings.md"), "state-view");
    expect(doc.events).toBeNull();
    expect(doc.invariants).toEqual([]);
    expect(doc.openQuestions).toEqual([]);
    const md = "# Slice: X\n## Intent\n<!-- fill me in -->\n## Scenarios\n<!-- none yet -->\n";
    const empty = parseSliceDoc(md, "state-view");
    expect(empty.intent).toBe("");
    expect(empty.scenarios).toEqual([]);
  });

  it.each(["INV-1", "INV-EO-1", "INV-ACCT-19", "INV-A1-B2-3"])("parses invariant id %s in bullets and rejected scenarios", (id) => {
    const md = [
      "# Slice: X",
      "## Invariants / Business Rules",
      `- **${id}:** Something must hold.`,
      "## Scenarios (Given / When / Then)",
      `- **Rejected (${id})** — Given a, When b, Then refused.`,
    ].join("\n");
    const doc = parseSliceDoc(md, "state-change");
    expect(doc.invariants).toEqual([{ id, text: "Something must hold." }]);
    expect(doc.scenarios[0]).toMatchObject({ kind: "rejected", invId: id });
  });

  it("does not accept a bare INV- or a non-INV token as an invariant id", () => {
    const md = "# Slice: X\n## Invariants\n- **INV-:** nope.\n- **REQ-1:** nope.\n- **INV 1:** nope.\n";
    expect(parseSliceDoc(md, "state-change").invariants).toEqual([]);
  });

  it("configured sectionAliases extend the built-ins without replacing them", () => {
    const aliases = mergeSectionAliases({ intent: ["Why"], readModel: ["Projection Shape"] });
    expect(aliases.intent).toEqual([...DEFAULT_SECTION_ALIASES.intent, "Why"]);
    const md = "# Slice: X\n## Why\nBecause.\n## Projection Shape\n- **View:** `Thing List`\n";
    const doc = parseSliceDoc(md, "state-view", "<doc>", undefined, { sectionAliases: aliases });
    expect(doc.intent).toBe("Because.");
    expect(doc.readModel?.view).toBe("Thing List");
    // Built-in heading still works with the merged table.
    expect(parseSliceDoc(loadFixture("recent-pings.md"), "state-view", "<doc>", undefined, { sectionAliases: aliases }).intent).not.toBe("");
  });

  it("the read model's built-from clause on the View line wins over a Source Events section", () => {
    const md = "# Slice: X\n## Source Events\n- Other Event\n## Read Model / View\n- **View:** `V` built from events: \"Primary Event\"\n";
    expect(parseSliceDoc(md, "state-view").readModel?.builtFromEvents).toBe('"Primary Event"');
  });

  it("records every H2 heading found, in order", () => {
    const doc = parseSliceDoc(loadFixture("nothing-maps.md"), "state-change");
    expect(doc.headings).toEqual(["Why", "What Happens", "Outcome", "Examples"]);
  });
});

describe("required-section completeness (#24)", () => {
  it("a complete template doc of each pattern passes", () => {
    expect(missingRequiredSections(parseSliceDoc(loadFixture("record-ping.md"), "state-change"))).toEqual([]);
    expect(missingRequiredSections(parseSliceDoc(loadFixture("recent-pings.md"), "state-view"))).toEqual([]);
    expect(missingRequiredSections(parseSliceDoc(loadFixture("send-notification.md"), "automation"))).toEqual([]);
    expect(() => assertSliceDocComplete(parseSliceDoc(loadFixture("record-ping.md"), "state-change"))).not.toThrow();
  });

  it("names every required field that parsed empty, the headings tried, and the headings found", () => {
    const doc = parseSliceDoc(loadFixture("nothing-maps.md"), "state-change", "slices/nothing-maps.md");
    expect(missingRequiredSections(doc).map((m) => m.key)).toEqual(["intent", "scenarios", "command", "events"]);
    let message = "";
    try {
      assertSliceDocComplete(doc, "slices/nothing-maps.md");
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeError);
      message = (err as Error).message;
    }
    expect(message).toMatch(/^slices\/nothing-maps\.md: required content for a state-change slice parsed empty \(4\)/);
    expect(message).toContain('- Intent [intent]: no prose under the heading. Headings tried: "Intent", "Purpose", "Goal"');
    expect(message).toContain("- Command / Input [command]: no `**Command:** `Name`` line.");
    expect(message).toContain("- Event(s) Emitted [events]:");
    expect(message).toContain("- Scenarios (Given / When / Then) [scenarios]:");
    expect(message).toContain('Headings found in the doc: "Why", "What Happens", "Outcome", "Examples"');
    expect(message).toContain('"sectionAliases" in .specify/em-sdd.json');
    expect(message).toContain('{ "sectionAliases": { "intent": ["<Your Heading>"] } }');
  });

  it("the same doc passes once its headings are configured as aliases", () => {
    const aliases = mergeSectionAliases({ intent: ["Why"], command: ["What Happens"], events: ["Outcome"], scenarios: ["Examples"] });
    const doc = parseSliceDoc(loadFixture("nothing-maps.md"), "state-change", "<doc>", undefined, { sectionAliases: aliases });
    expect(doc.command?.name).toBe("Do Thing");
    expect(doc.events?.name).toBe("Thing Done");
    expect(missingRequiredSections(doc, aliases)).toEqual([]);
  });

  it("required set is per pattern: a state-view needs a read model but no command; translation needs only intent + scenarios", () => {
    const base = "# Slice: X\n## Intent\nI.\n## Scenarios\n- **Happy path** — Given a, When b, Then c.\n";
    expect(missingRequiredSections(parseSliceDoc(base, "translation"))).toEqual([]);
    expect(missingRequiredSections(parseSliceDoc(base, "unclassified"))).toEqual([]);
    expect(missingRequiredSections(parseSliceDoc(base, "state-view")).map((m) => m.key)).toEqual(["readModel"]);
    expect(missingRequiredSections(parseSliceDoc(base, "automation")).map((m) => m.key)).toEqual(["events"]);
    expect(missingRequiredSections(parseSliceDoc(base, "state-change")).map((m) => m.key)).toEqual(["command", "events"]);
  });

  it("a doc with no ## headings at all says so", () => {
    expect(() => assertSliceDocComplete(parseSliceDoc("# Slice: X\njust prose", "translation"))).toThrow(
      /Headings found in the doc: \(no ## headings at all\)/
    );
  });
});

// #30: em's current template nests Given/When/Then as sub-bullets under the
// scenario label; the old parser folded them into one run-on string with the
// bold markers left in. INV ids may also carry a letter suffix (INV-CHK-3a).
describe("nested Given/When/Then scenarios and em's INV grammar (#30)", () => {
  const doc = parseSliceDoc(loadFixture("checkout-nested-gwt.md"), "state-change");

  it("parses each scenario into given/when/then clauses, joining wrapped clause lines", () => {
    expect(doc.scenarios).toHaveLength(4);
    expect(doc.scenarios[0]).toEqual({
      label: "Happy path",
      kind: "happy",
      invId: undefined,
      given: "a cart with two items",
      when: "the shopper checks out",
      then: "Checkout Completed is recorded and the Order Summary shows the new order.",
      text: "Given a cart with two items, When the shopper checks out, Then Checkout Completed is recorded and the Order Summary shows the new order.",
    });
    // No bold markers survive into the clause text or the sentence.
    for (const s of doc.scenarios) expect(s.text).not.toContain("**");
  });

  it("classifies Rejected (INV-...) labels, including a letter-suffixed id", () => {
    expect(doc.scenarios[1]).toMatchObject({ kind: "rejected", invId: "INV-CHK-1" });
    expect(doc.scenarios[2]).toMatchObject({ kind: "rejected", invId: "INV-CHK-3a" });
    expect(doc.scenarios[3]).toMatchObject({ kind: "edge", invId: undefined, label: "Stale cart" });
  });

  it("a nested bullet that is not a G/W/T clause stays with the open clause", () => {
    expect(doc.scenarios[3].then).toBe(
      "the command is rejected with a stale-cart reason. Note: the UI refreshes the cart and lets the shopper retry."
    );
  });

  it("parses letter-suffixed invariant ids and ignores nested rationale bullets", () => {
    expect(doc.invariants).toEqual([
      { id: "INV-CHK-1", text: "Reject Checkout when the cart is empty." },
      { id: "INV-CHK-3a", text: "Reject Checkout when the cart total is negative." },
    ]);
  });

  it("the ## Delta section's Requirement / Scenario blocks are not mistaken for invariants or scenarios", () => {
    expect(doc.invariants.map((i) => i.id)).not.toContain("INV-CHK-3a-from-delta");
    expect(doc.scenarios.map((s) => s.label)).not.toContain("negative total");
    expect(doc.headings[0]).toBe("Delta");
  });

  it("the one-line form still parses exactly as before, with no clause fields", () => {
    const old = parseSliceDoc(loadFixture("record-ping.md"), "state-change");
    expect(old.scenarios[0]).toMatchObject({ kind: "happy" });
    expect(old.scenarios[0].given).toBeUndefined();
    expect(old.scenarios[0].text).toMatch(/^Given no prior pings, When /);
  });

  it("the two forms can be mixed in one section", () => {
    const md = [
      "# Slice: X",
      "## Scenarios",
      "- **Happy path** — Given a, When b, Then c.",
      "- **Rejected (INV-X-1)**",
      "  - **Given:** d",
      "  - **When:** e",
      "  - **Then:** f.",
    ].join("\n");
    const mixed = parseSliceDoc(md, "state-change").scenarios;
    expect(mixed).toHaveLength(2);
    expect(mixed[0].given).toBeUndefined();
    expect(mixed[1]).toMatchObject({ given: "d", when: "e", then: "f.", invId: "INV-X-1" });
  });

  it("a label bullet with neither inline text nor clauses is skipped", () => {
    const md = "# Slice: X\n## Scenarios\n- **Placeholder**\n- **Happy path** — Given a, When b, Then c.\n";
    expect(parseSliceDoc(md, "state-change").scenarios.map((s) => s.label)).toEqual(["Happy path"]);
  });

  it.each(["INV-1", "INV-EO-1", "INV-ACCT-19", "INV-CHK-3a", "INV-eo-1", "INV-1X-2"])(
    "accepts %s, exactly as em's INV_TOKEN_RE does",
    (id) => {
      const md = `# Slice: X\n## Invariants\n- **${id}:** holds.\n## Scenarios\n- **Rejected (${id})** — Given a, When b, Then c.\n`;
      const d = parseSliceDoc(md, "state-change");
      expect(d.invariants).toEqual([{ id, text: "holds." }]);
      expect(d.scenarios[0]).toMatchObject({ kind: "rejected", invId: id });
    }
  );
});
