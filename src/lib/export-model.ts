/**
 * Types for `em export` JSON (schemaVersion 1.5+, verified against em 1.7.0).
 * As of MIL-91/MIL-85 (em 1.4/1.5), each slice carries two additional
 * sibling fields the bridge now consumes directly instead of re-deriving:
 *
 * - `pattern`: the slice's Event Modeling pattern, model-derived by em
 *   itself (`classifySlicePattern()`, the same function `em catalog` uses)
 *   from which element kinds the slice contains. The slice doc's own
 *   authored `pattern:` frontmatter value is NOT this -- em deliberately
 *   never reads it for this field (informational only, per
 *   docs/slice-doc-schema.md upstream).
 * - `doc`: the slice-doc frontmatter join (see `ExportedSliceDoc` below) --
 *   status/version/implementedIn/lineage sourced from the doc's canonical
 *   frontmatter, joined server-side. Only recognizes a `note` that is
 *   EXACTLY the slug convention `slices/<key>.md`; a non-convention note
 *   path (or no note at all) both produce `found: false, reason:
 *   "no-doc-bound"`. Never carries the doc's markdown body, swimlane, or
 *   Open Questions counts -- those stay out of export by design.
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

/** A slice's Event Modeling pattern, as em itself classifies it from element
 *  kinds -- distinguishes Automation from Translation, which the bridge's
 *  old element-kind-only classifier (retired) could not. */
export type SlicePattern = "translation" | "automation" | "state-change" | "state-view" | "unclassified";

/** Why `doc.found` is false, or why a found doc's fields are still empty.
 *  Null exactly when `found` is true and the frontmatter parsed cleanly. */
export type SliceDocJoinReason = "no-doc-bound" | "binding-missing-file" | "frontmatter-invalid" | null;

/** Implementation-drift classification from `status`+`implementedIn` alone
 *  (em's catalog/driftSignal.ts). Null only when `doc.found` is false. */
export type SliceDocDriftSignal =
  | "in-sync"
  | "never-implemented"
  | "unpropagated-delta"
  | "implemented-without-link"
  | null;

/** A parsed `<slice-key>@v<N>` lineage reference (split-from/merged-from/superseded-by). */
export interface SliceDocRef {
  raw: string;
  sliceKey: string | null;
  version: number | null;
}

/** The slice-doc frontmatter join for one slice -- always a non-null object
 *  (never JSON `null`), matching every other optional field in `em export`'s
 *  style. See the module doc comment above for the note-binding boundary. */
export interface ExportedSliceDoc {
  found: boolean;
  /** Always `slices/<key>.md` (the convention path), regardless of `found`. */
  path: string;
  reason: SliceDocJoinReason;
  status: string | null;
  version: number | null;
  implementedIn: string | null;
  splitFrom: SliceDocRef | null;
  mergedFrom: SliceDocRef[];
  supersededBy: SliceDocRef[];
  driftSignal: SliceDocDriftSignal;
}

export interface ExportedSlice {
  key: string;
  name: string;
  index: number;
  line: number;
  pattern: SlicePattern;
  doc: ExportedSliceDoc;
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
