/**
 * Repo-committed bridge configuration at `.specify/em-sdd.json`, parsed ONCE
 * per run (bridge.ts) and handed to every consumer that needs it -- the
 * design-completeness / events-first gates (lib/preconditions.ts) today, the
 * slice-doc parser's heading aliases (#24) and the TypeSpec compiler command
 * (#25) next. Keys:
 *
 *   {
 *     "contractSource": "typespec" | "none",
 *     "eventsFirst": boolean,
 *     "sectionAliases": { "<field>": ["<Heading>", ...], ... }
 *   }
 *
 * `contractSource` declares where this repo's generated contracts come from,
 * which decides whether the design-completeness gate's TypeSpec checks
 * (typespec/main.tsp exists + compiles) apply:
 *
 *   - "typespec" (the DEFAULT when the file is absent): current behavior,
 *     unchanged -- the checks run and their absence is a failure. Existing
 *     consumers keep their full gate without touching anything.
 *   - "none": this repo satisfies its contracts some other way (e.g.
 *     hand-authored event classes in the source tree); the TypeSpec checks are
 *     skipped. Every OTHER design-completeness check (slice docs resolvable,
 *     one .em model, slices/ populated) still runs.
 *
 * `eventsFirst` opts in to the events-first prerequisite (#13): when `true`,
 * every event a slice emits or consumes must already exist as a real type
 * declaration in the source tree before the bridge runs. DEFAULT is `false`
 * (absent file or absent field) -- see lib/preconditions.ts for the
 * trade-off. It is independent of `contractSource`.
 *
 * `sectionAliases` (#24) extends the slice-doc parser's built-in heading
 * aliases (lib/slice-doc.ts DEFAULT_SECTION_ALIASES) for docs written to a
 * different template: each key is one of SECTION_KEYS (`intent`, `command`,
 * `events`, `readModel`, `sourceEvents`, `scenarios`, ...) and each value a
 * non-empty list of H2 headings to accept for it, APPENDED to the built-ins
 * (the template headings always keep working). Unknown keys and malformed
 * values are failures, not ignored -- a typo here would otherwise silently
 * reproduce the empty-parse problem the key exists to fix.
 *
 * Deliberately a committed file, not a CLI flag: which convention a repo
 * follows is repo policy, decided in review -- not a per-invocation choice an
 * autonomous agent could quietly vary (the same reasoning that keeps the
 * gates in code at all). Unreadable JSON or an invalid value is a FAILURE,
 * never a silent fallback -- fail-closed. Failures are kept per owner so each
 * consumer reports only what concerns it (`fileFailure` concerns everyone),
 * and this module itself never throws: it collects, the consumers decide.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SECTION_KEYS, type SectionAliases, type SectionKey } from "./slice-doc.js";

export const BRIDGE_CONFIG_RELATIVE_PATH = path.join(".specify", "em-sdd.json");

const CONTRACT_SOURCES = ["typespec", "none"] as const;
export type ContractSource = (typeof CONTRACT_SOURCES)[number];

export interface BridgeConfig {
  contractSource: ContractSource;
  eventsFirst: boolean;
  /** Extra heading aliases per parsed field; only the keys the repo set. */
  sectionAliases: Partial<SectionAliases>;
  /** Config file unreadable as JSON -- concerns every consumer. */
  fileFailure?: string;
  contractSourceFailure?: string;
  eventsFirstFailure?: string;
  sectionAliasesFailure?: string;
}

export function bridgeConfigPath(repoRoot: string): string {
  return path.join(repoRoot, BRIDGE_CONFIG_RELATIVE_PATH);
}

export function readBridgeConfig(repoRoot: string): BridgeConfig {
  const config: BridgeConfig = { contractSource: "typespec", eventsFirst: false, sectionAliases: {} };
  const configPath = bridgeConfigPath(repoRoot);
  if (!existsSync(configPath)) return config;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    config.fileFailure = `${configPath} exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return config;
  }
  const record = (parsed ?? {}) as Record<string, unknown>;

  const rawSource = record["contractSource"];
  if (rawSource !== undefined) {
    if (typeof rawSource !== "string" || !CONTRACT_SOURCES.includes(rawSource as ContractSource)) {
      config.contractSourceFailure =
        `${configPath}: unknown "contractSource" value ${JSON.stringify(rawSource)} -- ` +
        `expected one of: ${CONTRACT_SOURCES.join(", ")}.`;
    } else {
      config.contractSource = rawSource as ContractSource;
    }
  }

  const rawEventsFirst = record["eventsFirst"];
  if (rawEventsFirst !== undefined) {
    if (typeof rawEventsFirst !== "boolean") {
      config.eventsFirstFailure =
        `${configPath}: invalid "eventsFirst" value ${JSON.stringify(rawEventsFirst)} -- ` +
        `expected a boolean (true to require events-first, false to skip it).`;
    } else {
      config.eventsFirst = rawEventsFirst;
    }
  }

  const rawAliases = record["sectionAliases"];
  if (rawAliases !== undefined) {
    const result = parseSectionAliases(rawAliases);
    if (typeof result === "string") {
      config.sectionAliasesFailure = `${configPath}: invalid "sectionAliases" -- ${result}`;
    } else {
      config.sectionAliases = result;
    }
  }
  return config;
}

/** Returns the clean partial alias map, or a string describing the first
 *  shape problem found. Exported for tests. */
export function parseSectionAliases(raw: unknown): Partial<SectionAliases> | string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return `expected an object mapping a section key to a list of headings, got ${JSON.stringify(raw)}.`;
  }
  const out: Partial<SectionAliases> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(SECTION_KEYS as readonly string[]).includes(key)) {
      return `unknown section key ${JSON.stringify(key)}; expected one of: ${SECTION_KEYS.join(", ")}.`;
    }
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.trim().length > 0)) {
      return `"${key}" must be a non-empty array of non-empty heading strings, got ${JSON.stringify(value)}.`;
    }
    out[key as SectionKey] = value.map((v: string) => v.trim());
  }
  return out;
}
