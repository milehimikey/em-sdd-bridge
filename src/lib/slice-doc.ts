/**
 * Parser for the event-modeling slice doc template's BODY content
 * (`.claude/skills/event-modeling/templates/slice.md`). Deliberately tolerant of
 * incidental whitespace but strict about the section headings the template
 * defines -- those are the mapping contract's "Source (slice.md)" column.
 *
 * As of MIL-94 (em >=1.7.0's joined export), this module parses ONLY what
 * `em export` deliberately excludes: the markdown body sections rendered
 * into spec.md (Intent, field tables, invariants, scenarios, ...). It no
 * longer parses frontmatter at all -- pattern/status/implementedIn/lineage
 * now come from `em export`'s `slice.pattern`/`slice.doc` fields
 * (export-model.ts), and readiness is fully delegated to `em validate
 * --slice-ready` (slice-readiness.ts). `pattern` is a required parameter of
 * parseSliceDoc below (supplied by the caller from the ExportedSlice it
 * already has), not something this parser derives.
 */

import { BridgeError } from "./bridge-error.js";
import type { SlicePattern } from "./export-model.js";

export interface FieldRow {
  field: string;
  type: string;
  required: string;
  rules: string;
}

export interface EventFieldRow {
  field: string;
  type: string;
  immutable: string;
  source: string;
}

export interface Scenario {
  label: string;
  text: string;
  kind: "happy" | "rejected" | "edge";
  invId?: string;
}

export interface OpenQuestion {
  checked: boolean;
  text: string;
}

export interface ParsedSliceDoc {
  name: string;
  /** Supplied by the caller (from the ExportedSlice it already has), not
   *  parsed here -- see the module doc comment above. */
  pattern: SlicePattern;
  intent: string;
  triggerActor: string;
  command: { name: string; fields: FieldRow[] } | null;
  events: { name: string; context: string; fields: EventFieldRow[] } | null;
  readModel: { view: string; consumedBy: string; freshness: string; builtFromEvents: string } | null;
  invariants: { id: string; text: string }[];
  scenarios: Scenario[];
  alternateErrorFlows: string[];
  nonFunctional: { security: string; pii: string; performance: string };
  openQuestions: OpenQuestion[];
  /** Every H2 heading the doc actually has, in order -- so a completeness
   *  failure can show what WAS found next to what was looked for. */
  headings: string[];
}

/**
 * The body sections the bridge reads, keyed by the field each one feeds.
 * Also the key space of `"sectionAliases"` in `.specify/em-sdd.json`
 * (lib/bridge-config.ts validates against SECTION_KEYS).
 */
export const SECTION_KEYS = [
  "intent",
  "triggerActor",
  "command",
  "events",
  "readModel",
  "sourceEvents",
  "invariants",
  "scenarios",
  "alternateErrorFlows",
  "nonFunctional",
  "openQuestions",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type SectionAliases = Record<SectionKey, string[]>;

/**
 * Built-in heading aliases (#24). The first entry of each list is the em
 * slice template's own heading -- the mapping contract's "Source (slice.md)"
 * column -- and the rest are headings seen in docs written to other
 * templates. Exact H2 lookups used to make any other heading an empty value
 * with no warning, so spec-kit planned from a near-empty spec. Matching is
 * case- and whitespace-insensitive (see normalizeHeading); a repo extends
 * these lists additively via `"sectionAliases"` in `.specify/em-sdd.json`.
 *
 * `sourceEvents` has no template heading of its own: the template packs the
 * read model's "built from events: ..." clause onto its `**View:**` line.
 * Docs that give the consumed events their own section feed the same field.
 */
export const DEFAULT_SECTION_ALIASES: SectionAliases = {
  intent: ["Intent", "Purpose", "Goal"],
  triggerActor: ["Trigger & Actor", "Trigger / Actor", "Trigger", "Actor", "Read Trigger", "Query"],
  command: ["Command / Input", "Command", "Input"],
  events: ["Event(s) Emitted", "Events Emitted", "Event Emitted", "Events", "Event"],
  readModel: ["Read Model / View", "Read Model", "View", "Projection"],
  sourceEvents: ["Source Events", "Data Source", "Built From Events", "Consumed Events"],
  invariants: ["Invariants / Business Rules", "Invariants", "Business Rules", "Rules"],
  scenarios: ["Scenarios (Given / When / Then)", "Scenarios", "Acceptance Scenarios", "Given / When / Then"],
  alternateErrorFlows: ["Alternate & Error Flows", "Alternate / Error Flows", "Alternate Flows", "Error Flows"],
  nonFunctional: ["Non-Functional Requirements", "Non-Functional", "NFRs", "NFR"],
  openQuestions: ["Open Questions", "Questions"],
};

/** Case-, whitespace- and trailing-punctuation-insensitive heading identity. */
function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([/&])\s*/g, " $1 ")
    .replace(/[\s:.]+$/, "")
    .trim();
}

/** Appends a repo's configured aliases to the built-ins (never replaces:
 *  the template headings always keep working). Validation of the raw config
 *  shape is bridge-config.ts's job; this takes a clean partial map. */
export function mergeSectionAliases(overrides?: Partial<SectionAliases>): SectionAliases {
  const merged = { ...DEFAULT_SECTION_ALIASES };
  if (!overrides) return merged;
  for (const key of SECTION_KEYS) {
    const extra = overrides[key];
    if (extra && extra.length > 0) merged[key] = [...DEFAULT_SECTION_ALIASES[key], ...extra];
  }
  return merged;
}

interface Section {
  heading: string;
  text: string;
}

/** HTML comments are the template's "omitted" markers (`<!-- none -->`);
 *  they must never count as content, so they are dropped before any section
 *  is read. */
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function splitSections(body: string): Section[] {
  const sections: Section[] = [];
  const re = /^##\s+(.+?)\s*$/gm;
  const matches = [...body.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    sections.push({ heading, text: stripHtmlComments(body.slice(start, end)).trim() });
  }
  return sections;
}

/** First section whose heading matches any alias for `key`, in alias order
 *  (so the template heading wins when a doc somehow carries two). */
function findSection(sections: Section[], aliases: SectionAliases, key: SectionKey): string | undefined {
  for (const alias of aliases[key]) {
    const want = normalizeHeading(alias);
    const hit = sections.find((s) => normalizeHeading(s.heading) === want);
    if (hit) return hit.text;
  }
  return undefined;
}

/** Event names from a stand-alone source-events section: one per bullet
 *  (or per table row's first cell), else every backticked token, joined the
 *  way the template's "built from events:" clause reads. */
function parseEventNames(text: string): string {
  const bullets = parseBulletList(text);
  if (bullets.length > 0) return bullets.join(", ");
  const rows = parseTable(text).slice(1).map((r) => r[0]).filter(Boolean);
  if (rows.length > 0) return rows.join(", ");
  const ticks = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (ticks.length > 0) return ticks.join(", ");
  return text.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
}

function bulletValue(text: string, label: string): string {
  // Template style is "**Label:**" (colon INSIDE the bold), e.g. "- **Status:** ready-to-implement".
  // Also accept "**Label**:" defensively in case a doc is authored the other way.
  const re = new RegExp(`\\*\\*${label}:?\\*\\*:?\\s*(.+)`, "i");
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return "";
}

function parseTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    // Skip header separator rows like | --- | --- |
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

function stripBullet(line: string): string {
  return line.replace(/^-\s*/, "").trim();
}

/**
 * Invariant id grammar (#24): `INV-<n>` or domain-prefixed `INV-EO-1`,
 * `INV-ACCT-19`, `INV-A1-B2-3` -- em's own template now shows
 * `INV-{{MNEMONIC}}-n`. Each prefix segment starts with an uppercase letter;
 * the final segment is the number. Source text (no anchors, no groups) so it
 * can be embedded in both the invariant-bullet and rejected-scenario regexes.
 */
const INV_ID = "INV-(?:[A-Z][A-Z0-9]*-)*\\d+";

function parseScenarios(text: string): Scenario[] {
  if (!text) return [];
  const scenarios: Scenario[] = [];
  // Bullets may wrap onto continuation lines; join lines that don't start a new bullet.
  const lines = text.split("\n");
  const joined: string[] = [];
  for (const line of lines) {
    if (/^-\s/.test(line) || joined.length === 0) {
      joined.push(line);
    } else if (line.trim() !== "") {
      joined[joined.length - 1] += " " + line.trim();
    }
  }
  for (const raw of joined) {
    const bullet = stripBullet(raw);
    if (!bullet) continue;
    const m = bullet.match(/^\*\*(.+?)\*\*\s*(?:—|--|-)\s*(.+)$/);
    if (!m) continue;
    const [, label, rest] = m;
    let kind: Scenario["kind"] = "edge";
    let invId: string | undefined;
    if (/^happy path$/i.test(label.trim())) {
      kind = "happy";
    } else {
      const invMatch = label.match(new RegExp(`rejected\\s*\\((${INV_ID})\\)`, "i"));
      if (invMatch) {
        kind = "rejected";
        invId = invMatch[1];
      }
    }
    scenarios.push({ label: label.trim(), text: rest.trim(), kind, invId });
  }
  return scenarios;
}

function parseInvariants(text: string): { id: string; text: string }[] {
  if (!text) return [];
  const out: { id: string; text: string }[] = [];
  for (const line of text.split("\n")) {
    const m = stripBullet(line).match(new RegExp(`^\\*\\*(${INV_ID}):?\\*\\*:?\\s*(.+)$`));
    if (m) out.push({ id: m[1], text: m[2].trim() });
  }
  return out;
}

function parseOpenQuestions(text: string): OpenQuestion[] {
  if (!text) return [];
  const out: OpenQuestion[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^-\s*\[( |x|X)\]\s*(.+)$/);
    if (m) out.push({ checked: m[1].toLowerCase() === "x", text: m[2].trim() });
  }
  return out;
}

function parseBulletList(text: string): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .filter((l) => /^-\s/.test(l.trim()))
    .map((l) => stripBullet(l))
    .filter(Boolean);
}

/**
 * The H1. `em slice new` writes `# Slice: <Name>`; skill-authored docs also
 * use a pattern-prefixed form (`# State View Slice: Provisioners`,
 * `# State Change Slice: Create Account`), which used to be rejected outright
 * and made whole models unusable with the bridge (#23). The optional prefix is
 * one of the four Event Modeling pattern names, case-insensitive; the name is
 * taken WITHOUT it.
 */
const TITLE_RE = /^#\s*(?:(?:State\s+Change|State\s+View|Automation|Translation)\s+)?Slice:\s*(.+?)\s*$/im;

/**
 * @param fallbackName  Used when the doc has no `# Slice:` H1 at all --
 *   bridge.ts passes the exported slice's display name, which em derives from
 *   the model itself (the same source the doc's frontmatter is joined from),
 *   so the H1 is a convenience, not the only authority. Absent (or blank) a
 *   title-less doc is still an error: the bridge never invents a name.
 */
export interface ParseSliceDocOptions {
  /** Merged alias table (mergeSectionAliases); defaults to the built-ins. */
  sectionAliases?: SectionAliases;
}

export function parseSliceDoc(
  markdown: string,
  pattern: SlicePattern,
  sourceLabel = "<slice doc>",
  fallbackName?: string,
  options: ParseSliceDocOptions = {}
): ParsedSliceDoc {
  const aliases = options.sectionAliases ?? DEFAULT_SECTION_ALIASES;
  const titleMatch = markdown.match(TITLE_RE);
  const name = titleMatch?.[1].trim() || fallbackName?.trim() || "";
  if (!name) {
    throw new BridgeError(
      `${sourceLabel}: missing "# Slice: <Name>" (or "# <Pattern> Slice: <Name>") heading, and no slice name ` +
        `was available from \`em export\` to fall back on`
    );
  }

  const sections = splitSections(markdown);
  const section = (key: SectionKey) => findSection(sections, aliases, key);

  const intent = (section("intent") ?? "").trim();
  const triggerActor = (section("triggerActor") ?? "").trim();

  let command: ParsedSliceDoc["command"] = null;
  const commandSection = section("command");
  if (commandSection) {
    const cmdName =
      commandSection.match(/\*\*Command:\*\*\s*`([^`]+)`/)?.[1] ??
      bulletValue(commandSection, "Command").replace(/`/g, "");
    const rows = parseTable(commandSection)
      .slice(1) // header row
      .map(([field, type, required, rules]) => ({ field, type, required, rules }));
    if (cmdName) command = { name: cmdName, fields: rows };
  }

  let events: ParsedSliceDoc["events"] = null;
  const eventSection = section("events");
  if (eventSection) {
    const evMatch = eventSection.match(/\*\*Event:\*\*\s*`([^`]+)`\s*(?:→|->)\s*context\s*`([^`]+)`/);
    const rows = parseTable(eventSection)
      .slice(1)
      .map(([field, type, immutable, source]) => ({ field, type, immutable, source }));
    if (evMatch) events = { name: evMatch[1], context: evMatch[2], fields: rows };
  }

  let readModel: ParsedSliceDoc["readModel"] = null;
  const readModelSection = section("readModel");
  const sourceEventsSection = section("sourceEvents");
  if (readModelSection) {
    // The template's `**View:**` bullet packs the view name AND its
    // "built from events: ..." clause onto one line, e.g.:
    //   - **View:** `Recent Pings` built from events: "Ping Recorded"
    // Other templates label the same bullet "Read Model" or "Name", or just
    // name the view in backticks; the name is taken from the first of
    // those that yields one. A stand-alone source-events section supplies
    // the built-from clause when the view line carries none.
    const viewLine =
      bulletValue(readModelSection, "View") ||
      bulletValue(readModelSection, "Read Model") ||
      bulletValue(readModelSection, "Name") ||
      readModelSection.match(/`([^`]+)`/)?.[0] ||
      "";
    const viewNameMatch = viewLine.match(/`([^`]+)`/);
    const builtFromMatch = viewLine.match(/built from events:\s*(.+)$/i);
    const consumedBy = bulletValue(readModelSection, "Consumed by");
    const freshness =
      bulletValue(readModelSection, "Freshness / consistency expectation") ||
      bulletValue(readModelSection, "Freshness") ||
      bulletValue(readModelSection, "Consistency");
    const view = viewNameMatch ? viewNameMatch[1] : viewLine;
    if (view) {
      readModel = {
        view,
        consumedBy,
        freshness,
        builtFromEvents: builtFromMatch
          ? builtFromMatch[1].trim()
          : sourceEventsSection
            ? parseEventNames(sourceEventsSection)
            : "",
      };
    }
  }

  const invariants = parseInvariants(section("invariants") ?? "");
  const scenarios = parseScenarios(section("scenarios") ?? "");
  const alternateErrorFlows = parseBulletList(section("alternateErrorFlows") ?? "");

  const nfrSection = section("nonFunctional") ?? "";
  const nonFunctional = {
    security: bulletValue(nfrSection, "Security / authz"),
    pii: bulletValue(nfrSection, "PII & compliance"),
    performance: bulletValue(nfrSection, "Performance / SLA"),
  };

  const openQuestions = parseOpenQuestions(section("openQuestions") ?? "");

  return {
    name,
    pattern,
    intent,
    triggerActor,
    command,
    events,
    readModel,
    invariants,
    scenarios,
    alternateErrorFlows,
    nonFunctional,
    openQuestions,
    headings: sections.map((s) => s.heading),
  };
}

/**
 * Which parsed fields a slice of each pattern cannot do without (#24). A
 * doc where one of these parsed empty used to produce a successful run on a
 * near-empty spec.md; now it is a refusal, consistent with the
 * design-completeness gate's fail-closed stance (a warning is what an
 * autonomous agent walks past). Deliberately minimal:
 *
 *  - every pattern: Intent, and at least one Given/When/Then scenario.
 *  - state-change: the command and the event it records.
 *  - state-view: the read model (a view name).
 *  - automation: the event -- under the merged reaction shape (em >=1.7.1)
 *    the reaction, its command and the recorded event share one slice.
 *  - translation: nothing further; an inbound translation may have no event
 *    of its own and an outbound one no command.
 *
 * Invariants, alternate flows, NFRs and open questions are always optional.
 */
const REQUIRED_SECTIONS: Record<SlicePattern, SectionKey[]> = {
  "state-change": ["intent", "scenarios", "command", "events"],
  "state-view": ["intent", "scenarios", "readModel"],
  automation: ["intent", "scenarios", "events"],
  translation: ["intent", "scenarios"],
  unclassified: ["intent", "scenarios"],
};

/** What "parsed empty" means per field -- so the failure says what the
 *  bridge looked for inside the section, not only which heading. */
const EMPTY_MEANS: Record<SectionKey, string> = {
  intent: "no prose under the heading",
  triggerActor: "no prose under the heading",
  command: "no `**Command:** \`Name\`` line",
  events: "no `**Event:** \`Name\` → context \`Ctx\`` line",
  readModel: "no view name (a `**View:**` / `**Read Model:**` / `**Name:**` bullet, or a backticked name)",
  sourceEvents: "no event names",
  invariants: "no `**INV-n:**` bullets",
  scenarios: "no `- **Label** — Given ... When ... Then ...` bullets",
  alternateErrorFlows: "no bullets",
  nonFunctional: "no labelled bullets",
  openQuestions: "no `- [ ]` / `- [x]` items",
};

function isEmpty(doc: ParsedSliceDoc, key: SectionKey): boolean {
  switch (key) {
    case "intent":
      return doc.intent.length === 0;
    case "triggerActor":
      return doc.triggerActor.length === 0;
    case "command":
      return doc.command === null;
    case "events":
      return doc.events === null;
    case "readModel":
      return doc.readModel === null;
    case "sourceEvents":
      return !doc.readModel || doc.readModel.builtFromEvents.length === 0;
    case "invariants":
      return doc.invariants.length === 0;
    case "scenarios":
      return doc.scenarios.length === 0;
    case "alternateErrorFlows":
      return doc.alternateErrorFlows.length === 0;
    case "nonFunctional":
      return !doc.nonFunctional.security && !doc.nonFunctional.pii && !doc.nonFunctional.performance;
    case "openQuestions":
      return doc.openQuestions.length === 0;
  }
}

export interface MissingSection {
  key: SectionKey;
  /** The template heading for this field. */
  label: string;
  /** Every heading alias that was tried, in order. */
  tried: string[];
}

/** The required fields (per `doc.pattern`) that parsed empty. Empty array =
 *  complete. Pure; never throws. */
export function missingRequiredSections(
  doc: ParsedSliceDoc,
  aliases: SectionAliases = DEFAULT_SECTION_ALIASES
): MissingSection[] {
  return REQUIRED_SECTIONS[doc.pattern]
    .filter((key) => isEmpty(doc, key))
    .map((key) => ({ key, label: aliases[key][0], tried: aliases[key] }));
}

/** Throws ONE BridgeError naming every required field that parsed empty, the
 *  headings tried for each, what counts as content, and the headings the doc
 *  actually has -- so the fix (rename a heading, add a `sectionAliases`
 *  entry, or author the missing content) is evident from the message. */
export function assertSliceDocComplete(
  doc: ParsedSliceDoc,
  sourceLabel = "<slice doc>",
  aliases: SectionAliases = DEFAULT_SECTION_ALIASES
): void {
  const missing = missingRequiredSections(doc, aliases);
  if (missing.length === 0) return;
  const found = doc.headings.length > 0 ? doc.headings.map((h) => `"${h}"`).join(", ") : "(no ## headings at all)";
  throw new BridgeError(
    `${sourceLabel}: required content for a ${doc.pattern} slice parsed empty (${missing.length}); ` +
      `refusing to generate a near-empty spec:\n` +
      missing
        .map((m) => `  - ${m.label} [${m.key}]: ${EMPTY_MEANS[m.key]}. Headings tried: ${m.tried.map((t) => `"${t}"`).join(", ")}`)
        .join("\n") +
      `\nHeadings found in the doc: ${found}\n` +
      `Fix: author the missing content, rename the heading to one listed above, or add the doc's heading to ` +
      `"sectionAliases" in .specify/em-sdd.json, e.g. { "sectionAliases": { "${missing[0].key}": ["<Your Heading>"] } }.`
  );
}
