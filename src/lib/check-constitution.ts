/**
 * Constitution advisory (MIL-203).
 *
 * `/speckit.plan` and `/speckit.tasks` read `.specify/memory/constitution.md`
 * as the project's governing rules -- but `specify init` scaffolds that file
 * from a stock template full of bracketed placeholder tokens
 * (`[PROJECT_NAME]`, `[PRINCIPLE_1_NAME]`, ...), and nothing stops a repo
 * from carrying that template, unfilled, indefinitely: it looks like a real
 * document from a distance and governs nothing.
 *
 * This module is advisory ONLY: it warns, it never gates. A team may
 * legitimately run without a filled constitution -- the goal is only that
 * they never do so unknowingly. Detection is mechanical (a placeholder-token
 * regex over the file's own text), the same fail-closed-tooling style as
 * lib/check-speckit-scaffold.ts's static source inspection -- no LLM, no new
 * gate, and this module NEVER throws or changes the caller's exit code.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The stock spec-kit constitution template's placeholder tokens, as they
 * appear in `.specify/templates/constitution-template.md`:
 *
 *   [PROJECT_NAME]
 *   [PRINCIPLE_<n>_NAME] / [PRINCIPLE_<n>_DESCRIPTION]   (the template ships five)
 *   [SECTION_<n>_NAME] / [SECTION_<n>_CONTENT]            (the template ships two)
 *   [GOVERNANCE_RULES]
 *   [CONSTITUTION_VERSION]
 *   [RATIFICATION_DATE]
 *   [LAST_AMENDED_DATE]
 *
 * The principle/section numbers are matched as `\d+` (not hardcoded to 1-5
 * or 2-3) so this still detects a partially-renumbered or hand-extended copy
 * of the template, not just the byte-identical stock file. All patterns
 * carry the `g` flag so every occurrence in the document is found, not just
 * the first.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[PROJECT_NAME\]/g,
  /\[PRINCIPLE_\d+_NAME\]/g,
  /\[PRINCIPLE_\d+_DESCRIPTION\]/g,
  /\[SECTION_\d+_NAME\]/g,
  /\[SECTION_\d+_CONTENT\]/g,
  /\[GOVERNANCE_RULES\]/g,
  /\[CONSTITUTION_VERSION\]/g,
  /\[RATIFICATION_DATE\]/g,
  /\[LAST_AMENDED_DATE\]/g,
];

export interface UnfilledConstitutionResult {
  /** True if any stock placeholder token was found in the text. */
  unfilled: boolean;
  /** Every distinct placeholder token found, sorted ascending -- deterministic
   *  for identical input, never dependent on Set/regex iteration order. */
  tokens: string[];
}

/**
 * Pure, mechanical detection: does `text` still contain any of spec-kit's
 * stock constitution-template placeholder tokens? Presence-of-placeholder
 * detection only -- a document that has replaced every bracketed token (even
 * with a single word) reads as filled, regardless of how thin its content
 * is. No LLM, no judgment about content quality.
 */
export function detectUnfilledConstitution(text: string): UnfilledConstitutionResult {
  const found = new Set<string>();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) for (const match of matches) found.add(match);
  }
  const tokens = [...found].sort();
  return { unfilled: tokens.length > 0, tokens };
}

/**
 * If `<repoRoot>/.specify/memory/constitution.md` exists and still contains
 * stock template placeholder tokens, prints ONE warning line via `log`
 * (default: `console.error`, i.e. stderr). Advisory only:
 *
 *   - A MISSING constitution.md prints nothing. This check is scoped to an
 *     existing file only, per the ticket -- a repo with no constitution at
 *     all gets no signal from this module (see README.md's "Constitution
 *     advisory" section for this as a documented gap).
 *   - Never throws. An unreadable file (permissions, race with a concurrent
 *     delete) is treated the same as "nothing to warn about" -- this check
 *     must never be the reason a real bridge invocation fails.
 *   - Never changes the caller's exit code; the caller decides nothing based
 *     on this function's return value (there isn't one).
 */
export function warnIfConstitutionUnfilled(repoRoot: string, log: (line: string) => void = console.error): void {
  const constitutionPath = path.join(repoRoot, ".specify", "memory", "constitution.md");
  if (!existsSync(constitutionPath)) return;

  let text: string;
  try {
    text = readFileSync(constitutionPath, "utf8");
  } catch {
    return;
  }

  const { unfilled, tokens } = detectUnfilledConstitution(text);
  if (!unfilled) return;

  log(
    `bridge: warning: .specify/memory/constitution.md is still spec-kit's unfilled template ` +
      `(found ${tokens.join(", ")}) -- /speckit.plan and /speckit.tasks will run against a ` +
      `constitution that governs nothing; fill it in (em >= 1.11: the event-modeling-implement ` +
      `skill's constitution step) or ratify a real one`
  );
}
