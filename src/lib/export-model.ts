/**
 * Types for `em export` JSON (schemaVersion 1.0) and the slice-role/pattern-pair
 * inference the bridge needs from it. The export does not carry a "Pattern" field
 * per slice (that lives only in the slice doc) -- roles below are inferred purely
 * from element `kind`s, per `.claude/skills/event-modeling/reference/em-dsl.md`.
 */

export interface ExportedField {
  name: string;
  type: string;
}

export interface ExportedElementRef {
  name: string;
  ref: string;
}

export interface ExportedElement {
  ref: string;
  kind: "ui" | "command" | "view" | "event" | "processor" | "translation" | string;
  name: string;
  line: number;
  fields: ExportedField[] | null;
  note: string | null;
  issue: string | null;
  from: ExportedElementRef[] | null;
  persona: string | null;
  context: string | null;
  again: boolean;
  logicalRef: string | null;
}

export interface ExportedSlice {
  key: string;
  name: string;
  index: number;
  line: number;
  elements: ExportedElement[];
}

export interface ExportedModel {
  schemaVersion: string;
  generator: { name: string; version: string };
  source: { path: string; sha256: string };
  model: {
    name: string;
    personas: string[];
    contexts: string[];
    hasAutomation: boolean;
    slices: ExportedSlice[];
    arrows: unknown[];
  };
  diagnostics: unknown[];
}

/** Structural role of a slice, inferred from its element kinds. */
export type SliceRole = "state-change" | "state-view" | "reaction" | "unknown";

export function classifySlice(slice: ExportedSlice): SliceRole {
  const kinds = new Set(slice.elements.map((e) => e.kind));
  const hasCommand = kinds.has("command");
  const hasEvent = kinds.has("event");
  const hasView = kinds.has("view");
  const hasReactor = kinds.has("processor") || kinds.has("translation");

  if (hasReactor && !hasCommand && !hasEvent) return "reaction";
  if (hasCommand && hasEvent) return "state-change";
  if (hasView && !hasCommand && !hasReactor) return "state-view";
  return "unknown";
}

export function findSliceByKey(model: ExportedModel, key: string): ExportedSlice | undefined {
  return model.model.slices.find((s) => s.key === key);
}

/**
 * Find the first non-null `note` among a slice's elements -- the DSL allows
 * `note "path.md"` on any element, and the slice-doc convention (em-dsl.md /
 * event-modeling SKILL) is "one per slice", so the first note found is treated
 * as the slice's doc link. Falls back to the slug-based convention
 * `slices/<key>.md` documented in the mapping contract's Traceability line
 * when no element carries an explicit note (e.g. minimal fixtures/models that
 * predate the note being wired up).
 */
export function findSliceDocRelativePath(slice: ExportedSlice): string {
  const noted = slice.elements.find((e) => e.note);
  if (noted?.note) return noted.note;
  return `slices/${slice.key}.md`;
}
