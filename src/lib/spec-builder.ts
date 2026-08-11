/**
 * Renders `spec.md` per your project's slice-to-spec mapping contract (see
 * that doc for judgment calls where it under-specifies bundle behavior).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type { ParsedSliceDoc } from "./slice-doc.js";

export interface BuildSpecOptions {
  branchName: string;
  date: string; // YYYY-MM-DD
  keys: string[]; // primary key first, secondary (if any) second
  pattern: string;
  primaryDoc: ParsedSliceDoc;
  secondaryDoc?: ParsedSliceDoc;
  sliceDocRelPaths: string[]; // matches `keys` order
  modelName: string; // basename of the resolved .em model file, e.g. "model.em"
  /**
   * Absolute directory containing the resolved .em model file. Used to decide
   * whether the Traceability line's `parking-lot` segment is rendered at all
   * (a sanctioned adaptation): an earlier version of this renderer hardcoded
   * a `parking-lot.md` link unconditionally, which produces a dead link for
   * any component dir that doesn't keep one. Passing this as an explicit
   * option (rather than reaching into the filesystem from deep inside the
   * render call implicitly) keeps the fs touchpoint visible at the call site
   * and the render function's other behavior easy to unit test. Also used,
   * together with `specFilePath`, to compute the link's actual relative
   * target.
   */
  modelDir?: string;
  /**
   * Absolute path of the spec.md file this content will be written to
   * (`allocateFeature()`'s `specFile`, known before rendering -- see
   * bridge.ts). Used ONLY to compute the parking-lot link's relative target
   * correctly: `path.relative(path.dirname(specFilePath), path.join(modelDir,
   * "parking-lot.md"))`. Without it, the link falls back to the historical
   * `../../parking-lot.md` literal, which is only correct when the model
   * lives at repo root (specs/NNN-slug/spec.md -> ../../ -> repo root) --
   * wrong whenever `modelDir` is a component subdirectory. Optional so
   * existing builder unit tests that don't allocate a real spec file keep
   * working unchanged.
   */
  specFilePath?: string;
}

function lowerFirst(s: string): string {
  if (!s) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** Mapping example is `... in the future (INV-1)` with no stray full stop
 *  before the tag, so drop one trailing period from the invariant's own
 *  prose before appending `(INV-n)`. */
function stripTrailingPeriod(s: string): string {
  return s.replace(/\.\s*$/, "");
}

function boldGwt(text: string): string {
  return text
    .replace(/\bGiven\b/, "**Given**")
    .replace(/\bWhen\b/, "**When**")
    .replace(/\bThen\b/, "**Then**");
}

function firstSentence(text: string): string {
  const m = text.match(/^[^.]*\./);
  return m ? m[0].trim() : text.trim();
}

class Counter {
  private n = 0;
  next(): string {
    this.n += 1;
    return String(this.n).padStart(3, "0");
  }
}

export function buildSpecMarkdown(opts: BuildSpecOptions): string {
  const { primaryDoc, secondaryDoc } = opts;
  const isBundle = !!secondaryDoc;

  const lines: string[] = [];

  // --- Header --------------------------------------------------------
  lines.push(`# Feature Specification: ${primaryDoc.name}`, "");
  lines.push(`**Feature Branch**: \`${opts.branchName}\``, "");
  lines.push(`**Created**: ${opts.date}`, "");
  lines.push(`**Status**: Draft`, "");

  const keyList = opts.keys.map((k) => `\`${k}\``).join(", ");
  const docList = opts.sliceDocRelPaths.map((p) => `\`${p}\``).join(", ");
  // Sanctioned adaptation: the parking-lot segment is only included when a
  // parking-lot.md actually exists relative to the model dir -- an earlier
  // renderer always rendered it, producing a dead link for any component
  // dir that doesn't keep one (see BuildSpecOptions.modelDir doc comment).
  const parkingLotAbsolute = opts.modelDir ? path.join(opts.modelDir, "parking-lot.md") : undefined;
  const hasParkingLot = !!parkingLotAbsolute && existsSync(parkingLotAbsolute);
  let parkingLotSegment = "";
  if (hasParkingLot) {
    // Computes the link's actual relative target from specFilePath's
    // directory to parking-lot.md's real location, instead of hardcoding
    // `../../parking-lot.md` (only correct when the model lives at repo
    // root -- wrong for any component subdirectory). specFilePath is
    // optional so pre-existing builder unit tests that don't allocate a
    // real spec file keep exercising the historical literal unchanged.
    const linkTarget = opts.specFilePath
      ? path
          .relative(path.dirname(opts.specFilePath), parkingLotAbsolute!)
          .split(path.sep)
          .join("/") // forward slashes in the rendered Markdown link regardless of platform
      : "../../parking-lot.md";
    parkingLotSegment = ` · parking-lot: [parking-lot.md](${linkTarget})`;
  }
  lines.push(
    `**Traceability**: slice key(s) ${keyList} · pattern \`${opts.pattern}\` · model \`${opts.modelName}\`${parkingLotSegment} · ` +
      `slice doc(s): ${docList}`,
    ""
  );
  lines.push(`**Input**: User description: "${primaryDoc.intent}"`, "");

  // --- User Scenarios & Testing ---------------------------------------
  lines.push(`## User Scenarios & Testing`, "");
  lines.push(`### User Story 1 - ${primaryDoc.name} (Priority: P1)`, "");
  const journey = [primaryDoc.intent, primaryDoc.triggerActor].filter(Boolean).join(" ");
  lines.push(journey, "");
  lines.push(`**Why this priority**: ${firstSentence(primaryDoc.intent)}`, "");

  if (isBundle) {
    lines.push(
      `**Independent Test**: Tested as a unit with \`${secondaryDoc!.name}\` — not independently ` +
        `testable per the Automation/Translation bundling rule (see the project's constitution).`,
      ""
    );
  } else {
    const happy = primaryDoc.scenarios.find((s) => s.kind === "happy");
    lines.push(
      `**Independent Test**: Can be fully tested by ${happy ? happy.text : "exercising the slice's happy path"} ` +
        `and delivers the recorded fact / read-model change described above.`,
      ""
    );
  }

  lines.push(`**Acceptance Scenarios**:`, "");
  const allScenarios = isBundle
    ? [...primaryDoc.scenarios, ...secondaryDoc!.scenarios]
    : primaryDoc.scenarios;
  allScenarios.forEach((s, i) => {
    lines.push(`${i + 1}. ${boldGwt(s.text)}`);
  });
  lines.push("", "---", "");

  lines.push(`### Edge Cases`, "");
  const edgeFlows = isBundle
    ? [...primaryDoc.alternateErrorFlows, ...secondaryDoc!.alternateErrorFlows]
    : primaryDoc.alternateErrorFlows;
  if (edgeFlows.length === 0) {
    lines.push(`- None recorded in the slice doc(s).`);
  } else {
    for (const flow of edgeFlows) lines.push(`- ${flow}`);
  }
  lines.push("");

  // --- Requirements ----------------------------------------------------
  lines.push(`## Requirements`, "");
  lines.push(`### Functional Requirements`, "");

  const fr = new Counter();
  const frLines: string[] = [];

  const emitFieldFrs = (doc: ParsedSliceDoc) => {
    if (!doc.command) return;
    for (const row of doc.command.fields) {
      if (!row.rules || /^(none|n\/a)$/i.test(row.rules.trim())) continue;
      const requirement = /^y/i.test(row.required)
        ? `System MUST require \`${row.field}\` (${row.type}) on \`${doc.command.name}\` — ${row.rules}`
        : `System MUST accept optional \`${row.field}\` (${row.type}) on \`${doc.command.name}\` — ${row.rules}`;
      frLines.push(`- **FR-${fr.next()}**: ${requirement}`);
    }
  };

  const emitInvariantFrs = (doc: ParsedSliceDoc) => {
    for (const inv of doc.invariants) {
      frLines.push(`- **FR-${fr.next()}**: System MUST ${stripTrailingPeriod(lowerFirst(inv.text))} (${inv.id})`);
    }
  };

  const emitReadModelFr = (doc: ParsedSliceDoc) => {
    if (!doc.readModel) return;
    if (!/state view/i.test(doc.pattern)) return;
    const events = doc.readModel.builtFromEvents || "the upstream event(s)";
    const freshness = doc.readModel.freshness || "eventual";
    frLines.push(
      `- **FR-${fr.next()}**: System MUST expose \`${doc.readModel.view}\` reflecting ${events} ` +
        `with ${freshness} consistency.`
    );
  };

  const emitClarificationFrs = (doc: ParsedSliceDoc) => {
    for (const q of doc.openQuestions) {
      if (q.checked) continue;
      frLines.push(`- **FR-${fr.next()}**: [NEEDS CLARIFICATION: ${q.text}]`);
    }
  };

  emitFieldFrs(primaryDoc);
  emitInvariantFrs(primaryDoc);
  emitReadModelFr(primaryDoc);
  emitClarificationFrs(primaryDoc);
  if (isBundle) {
    emitFieldFrs(secondaryDoc!);
    emitInvariantFrs(secondaryDoc!);
    emitReadModelFr(secondaryDoc!);
    emitClarificationFrs(secondaryDoc!);
  }

  lines.push(...(frLines.length > 0 ? frLines : [`- None derived from the slice doc(s).`]), "");

  // Key Entities: Read Model / View ONLY; omit entirely if neither doc has one.
  const readModelDocs = [primaryDoc, secondaryDoc].filter(
    (d): d is ParsedSliceDoc => !!d && !!d.readModel
  );
  if (readModelDocs.length > 0) {
    lines.push(`### Key Entities`, "");
    const seen = new Set<string>();
    for (const doc of readModelDocs) {
      const rm = doc.readModel!;
      if (seen.has(rm.view)) continue;
      seen.add(rm.view);
      const desc = [
        rm.builtFromEvents ? `built from ${rm.builtFromEvents}` : "",
        rm.consumedBy ? `consumed by ${rm.consumedBy}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      lines.push(`- **${rm.view}**: ${desc || "read model produced by this slice"}`);
    }
    lines.push("");
  }

  // --- Success Criteria --------------------------------------------------
  lines.push(`## Success Criteria`, "");
  lines.push(`### Measurable Outcomes`, "");
  const sc = new Counter();
  const scLines: string[] = [];

  const emitOutcomeScs = (doc: ParsedSliceDoc) => {
    const happy = doc.scenarios.find((s) => s.kind === "happy");
    if (happy) {
      scLines.push(`- **SC-${sc.next()}**: The happy-path scenario passes: ${happy.text}`);
    }
    if (doc.nonFunctional.performance && !/^(none|n\/a)$/i.test(doc.nonFunctional.performance.trim())) {
      scLines.push(`- **SC-${sc.next()}**: ${doc.nonFunctional.performance}`);
    }
    if (/state view/i.test(doc.pattern) && doc.readModel?.freshness) {
      const events = doc.readModel.builtFromEvents || "the upstream event(s)";
      scLines.push(`- **SC-${sc.next()}**: Reads reflect ${events} within ${doc.readModel.freshness} consistency.`);
    }
  };

  emitOutcomeScs(primaryDoc);
  if (isBundle) emitOutcomeScs(secondaryDoc!);

  lines.push(...(scLines.length > 0 ? scLines : [`- None derived from the slice doc(s).`]), "");

  // --- Assumptions ---------------------------------------------------
  lines.push(`## Assumptions`, "");
  lines.push(
    `- No unstated assumptions — slice(s) ratified before this spec was generated ` +
      `(two-stage ratification: em model review, then this bridge run).`
  );
  lines.push("");

  return lines.join("\n");
}
