/**
 * Parser for the event-modeling slice doc template
 * (`.claude/skills/event-modeling/templates/slice.md`). Deliberately tolerant of
 * incidental whitespace but strict about the section headings the template
 * defines -- those are the mapping contract's "Source (slice.md)" column.
 */

import { BridgeError } from "./bridge-error.js";

export type SliceStatus = "draft" | "reviewed" | "ready-to-implement" | "implemented";

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
  pattern: string;
  swimlane: string;
  status: string;
  implementedIn: string;
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
}

function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const re = /^##\s+(.+?)\s*$/gm;
  const matches = [...body.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    sections.set(heading, body.slice(start, end).trim());
  }
  return sections;
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

/**
 * Top-level scalar keys from a leading YAML frontmatter block (`---` ...
 * `---`), if the doc has one. Fallback source for docs authored in the
 * frontmatter style (e.g. `status: ready-to-implement` / `pattern:
 * state-view` in YAML) rather than the body-label style this parser was
 * originally built against -- both slice-doc dialects exist in real repos,
 * and the bridge's readiness gate reading "(missing)" off a frontmatter-style
 * doc was a live interop failure. Deliberately minimal: scalars only (list
 * items and indented continuation lines are skipped); the body-label value
 * always wins when both are present, since the body is the
 * template-contract surface.
 */
function parseYamlFrontmatter(markdown: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) return values;
  const lines = markdown.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^---\s*$/.test(line)) break; // closing fence
    if (/^\s/.test(line) || line.trimStart().startsWith("-")) continue; // nested/list content
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (value) values.set(m[1].toLowerCase(), value);
  }
  return values;
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
      const invMatch = label.match(/rejected\s*\((INV-\d+)\)/i);
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
    const m = stripBullet(line).match(/^\*\*(INV-\d+):?\*\*:?\s*(.+)$/);
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

export function parseSliceDoc(markdown: string, sourceLabel = "<slice doc>"): ParsedSliceDoc {
  const titleMatch = markdown.match(/^#\s*Slice:\s*(.+)\s*$/m);
  if (!titleMatch) {
    throw new BridgeError(`${sourceLabel}: missing "# Slice: <Name>" heading`);
  }
  const name = titleMatch[1].trim();

  const frontmatterEnd = markdown.search(/^##\s+/m);
  const frontmatter = frontmatterEnd === -1 ? markdown : markdown.slice(0, frontmatterEnd);
  const yaml = parseYamlFrontmatter(markdown);

  // Body-label first (the template contract), YAML frontmatter as fallback
  // for docs authored in the frontmatter dialect.
  const pattern = bulletValue(frontmatter, "Pattern") || yaml.get("pattern") || "";
  const swimlane = bulletValue(frontmatter, "Swimlane");
  const status = bulletValue(frontmatter, "Status") || yaml.get("status") || "";
  const implementedIn = bulletValue(frontmatter, "Implemented in") || yaml.get("implementedin") || "";

  const sections = splitSections(markdown);

  const intent = (sections.get("Intent") ?? "").trim();
  const triggerActor = (sections.get("Trigger & Actor") ?? "").trim();

  let command: ParsedSliceDoc["command"] = null;
  const commandSection = sections.get("Command / Input");
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
  const eventSection = sections.get("Event(s) Emitted");
  if (eventSection) {
    const evMatch = eventSection.match(/\*\*Event:\*\*\s*`([^`]+)`\s*(?:→|->)\s*context\s*`([^`]+)`/);
    const rows = parseTable(eventSection)
      .slice(1)
      .map(([field, type, immutable, source]) => ({ field, type, immutable, source }));
    if (evMatch) events = { name: evMatch[1], context: evMatch[2], fields: rows };
  }

  let readModel: ParsedSliceDoc["readModel"] = null;
  const readModelSection = sections.get("Read Model / View");
  if (readModelSection) {
    // The template's `**View:**` bullet packs the view name AND its
    // "built from events: ..." clause onto one line, e.g.:
    //   - **View:** `Recent Pings` built from events: "Ping Recorded"
    const viewLine = bulletValue(readModelSection, "View");
    const viewNameMatch = viewLine.match(/`([^`]+)`/);
    const builtFromMatch = viewLine.match(/built from events:\s*(.+)$/i);
    const consumedBy = bulletValue(readModelSection, "Consumed by");
    const freshness = bulletValue(readModelSection, "Freshness / consistency expectation");
    const view = viewNameMatch ? viewNameMatch[1] : viewLine;
    if (view) {
      readModel = {
        view,
        consumedBy,
        freshness,
        builtFromEvents: builtFromMatch ? builtFromMatch[1].trim() : "",
      };
    }
  }

  const invariants = parseInvariants(sections.get("Invariants / Business Rules") ?? "");
  const scenarios = parseScenarios(sections.get("Scenarios (Given / When / Then)") ?? "");
  const alternateErrorFlows = parseBulletList(sections.get("Alternate & Error Flows") ?? "");

  const nfrSection = sections.get("Non-Functional Requirements") ?? "";
  const nonFunctional = {
    security: bulletValue(nfrSection, "Security / authz"),
    pii: bulletValue(nfrSection, "PII & compliance"),
    performance: bulletValue(nfrSection, "Performance / SLA"),
  };

  const openQuestions = parseOpenQuestions(sections.get("Open Questions") ?? "");

  return {
    name,
    pattern,
    swimlane,
    status,
    implementedIn,
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
  };
}

/** Precondition gate (mapping doc "Preconditions" + TASK A brief): refuse unless
 *  ready-to-implement and every Open Question is checked off. */
export function assertReadyToImplement(doc: ParsedSliceDoc, sourceLabel: string): void {
  if (doc.status !== "ready-to-implement") {
    throw new BridgeError(
      `${sourceLabel}: Status is "${doc.status || "(missing)"}", not "ready-to-implement" -- refusing.`
    );
  }
  const unchecked = doc.openQuestions.filter((q) => !q.checked);
  if (unchecked.length > 0) {
    throw new BridgeError(
      `${sourceLabel}: ${unchecked.length} unchecked Open Question(s) remain -- refusing:\n` +
        unchecked.map((q) => `  - [ ] ${q.text}`).join("\n")
    );
  }
}
