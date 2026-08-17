/**
 * The default is one slice key per bridge invocation; bundling is permitted
 * ONLY for an Automation/Translation pattern-mandated pair (the
 * reactor/translator slice + the state-change slice it triggers). This module
 * validates that from `em export` data -- never from the slice docs' say-so
 * alone.
 */

import { BridgeError } from "./bridge-error.js";
import { findSliceByKey, type ExportedModel, type ExportedSlice, type SlicePattern } from "./export-model.js";

/** Reactor patterns for the bundling rule -- the reaction/translation slice
 *  that triggers the state-change slice immediately after it. Sourced from
 *  `em export`'s model-derived `slice.pattern` (export-model.ts), which
 *  distinguishes Automation from Translation -- the bridge's former
 *  element-kind-only classifier (retired) could not. */
const REACTOR_PATTERNS: ReadonlySet<SlicePattern> = new Set(["automation", "translation"]);

export interface ValidatedKeys {
  /** The primary slice -- the reactor/translator for a bundle, or the sole slice otherwise. */
  primary: ExportedSlice;
  /** Present only for a validated bundle pair. */
  secondary?: ExportedSlice;
}

export function validateSliceKeys(model: ExportedModel, keys: string[]): ValidatedKeys {
  if (keys.length === 0) {
    throw new BridgeError("At least one slice key is required.");
  }

  const slices = keys.map((key) => {
    const slice = findSliceByKey(model, key);
    if (!slice) {
      throw new BridgeError(`Slice key "${key}" not found in \`em export\` output.`);
    }
    return slice;
  });

  if (keys.length === 1) {
    return { primary: slices[0] };
  }

  if (keys.length > 2) {
    throw new BridgeError(
      `Bundling beyond a pattern-mandated pair is out of scope for the bridge (the slice-to-spec ` +
        `mapping contract's "Bundling" section does not define behavior for 3+ slice keys). ` +
        `Got ${keys.length} keys: ${keys.join(", ")}.`
    );
  }

  // Exactly 2 keys: must be a reactor slice (Automation or Translation)
  // immediately followed by the state-change slice it triggers (em-dsl.md:
  // "wires to the command in the immediately next slice"). Pattern comes
  // straight from `em export`'s model-derived slice.pattern -- never from
  // the slice docs' say-so alone.
  const [a, b] = slices;

  let reaction: ExportedSlice | undefined;
  let stateChange: ExportedSlice | undefined;
  if (REACTOR_PATTERNS.has(a.pattern) && b.pattern === "state-change") {
    reaction = a;
    stateChange = b;
  } else if (REACTOR_PATTERNS.has(b.pattern) && a.pattern === "state-change") {
    reaction = b;
    stateChange = a;
  }

  if (!reaction || !stateChange) {
    throw new BridgeError(
      `Refusing to bundle "${keys.join(
        ", "
      )}": not a pattern-mandated Automation/Translation pair. Expected one reactor slice ` +
        `(pattern "automation" or "translation") and one state-change slice (pattern "state-change"); ` +
        `got patterns [${a.pattern}, ${b.pattern}].`
    );
  }

  if (stateChange.index !== reaction.index + 1) {
    throw new BridgeError(
      `Refusing to bundle "${keys.join(", ")}": the state-change slice must be the reaction's ` +
        `immediately-next slice (em-dsl.md adjacency rule). Reaction is at index ${reaction.index}, ` +
        `state-change is at index ${stateChange.index}.`
    );
  }

  return { primary: reaction, secondary: stateChange };
}
