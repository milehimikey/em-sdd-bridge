/**
 * The default is one slice key per bridge invocation; bundling is permitted
 * ONLY for an Automation/Translation pattern-mandated pair (the
 * reactor/translator slice + the state-change slice it triggers). This module
 * validates that from `em export` data -- never from the slice docs' say-so
 * alone.
 */

import { BridgeError } from "./bridge-error.js";
import { classifySlice, findSliceByKey, type ExportedModel, type ExportedSlice } from "./export-model.js";

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

  // Exactly 2 keys: must be a reaction slice immediately followed by the
  // state-change slice it triggers (em-dsl.md: "wires to the command in the
  // immediately next slice").
  const [a, b] = slices;
  const roleA = classifySlice(a);
  const roleB = classifySlice(b);

  let reaction: ExportedSlice | undefined;
  let stateChange: ExportedSlice | undefined;
  if (roleA === "reaction" && roleB === "state-change") {
    reaction = a;
    stateChange = b;
  } else if (roleB === "reaction" && roleA === "state-change") {
    reaction = b;
    stateChange = a;
  }

  if (!reaction || !stateChange) {
    throw new BridgeError(
      `Refusing to bundle "${keys.join(
        ", "
      )}": not a pattern-mandated Automation/Translation pair. Expected one reaction slice ` +
        `(processor/translation, no command/event) and one state-change slice (command + event); ` +
        `got roles [${roleA}, ${roleB}].`
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
