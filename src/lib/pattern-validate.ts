/**
 * As of `em` >=1.7.1 (MIL-120), the Automation/Translation reaction, the
 * command it triggers, and the event that command emits all live in ONE
 * slice -- there is no longer a separate reactor slice to bundle with a
 * separate state-change slice (that split was retired upstream; see
 * em-dsl.md's "Pattern -> DSL mapping" section, pattern 3/4a-4c). One slice
 * key, one `em export` slice, one spec.md: no exception. This module's only
 * job is to validate that exactly one slice key was given and that it
 * resolves in `em export`'s output -- never from the slice docs' say-so
 * alone.
 *
 * This bridge (0.3.0) was built against the OLD two-slice split and used to
 * accept a [reactor, state-change] pair at adjacent indexes as a
 * "pattern-mandated pair" to bundle into one spec.md. Under the merged shape
 * no canonical model produces that pair anymore, and the old check was
 * pattern+index only (no `from`/arrow relationship) -- a merged automation
 * slice followed by an unrelated state-change slice would have been falsely
 * accepted and bundled. That bundling path is retired entirely (MIL-133):
 * multi-key invocations now refuse outright, with a message pointing the
 * caller at passing a single slice key.
 */

import { BridgeError } from "./bridge-error.js";
import { findSliceByKey, type ExportedModel, type ExportedSlice } from "./export-model.js";

export interface ValidatedKeys {
  /** The sole slice being bridged. */
  primary: ExportedSlice;
}

export function validateSliceKeys(model: ExportedModel, keys: string[]): ValidatedKeys {
  if (keys.length === 0) {
    throw new BridgeError("At least one slice key is required.");
  }

  if (keys.length > 1) {
    throw new BridgeError(
      `em-sdd-bridge takes exactly one slice key. As of the merged Automation/Translation reaction ` +
        `shape (\`em\` >=1.7.1, MIL-120), a reaction, the command it triggers, and the event that ` +
        `command emits all live in ONE slice -- there is no longer a separate reactor slice to ` +
        `bundle with a separate state-change slice, so 1 slice = 1 spec = 1 PR holds with no ` +
        `exception. Pass a single slice key. Got ${keys.length} keys: ${keys.join(", ")}.`
    );
  }

  const [key] = keys;
  return { primary: resolveSliceKey(model, key) };
}

const MAX_SUGGESTIONS = 5;

/**
 * Resolve the user-supplied key to an exported slice (#17). Exact export-key
 * match wins. Otherwise the input is treated as a display-name form
 * (`ABC-0039`): a case-insensitive prefix followed by `-` of exactly one
 * export key (`abc-0039-finalize-invoice`) resolves, and the resolution is
 * logged to stderr so it is never silent. Several matches refuse, listing the
 * candidates; no match refuses with up to five nearby keys. Fail closed: the
 * bridge never guesses between candidates.
 */
function resolveSliceKey(model: ExportedModel, input: string): ExportedSlice {
  const exact = findSliceByKey(model, input);
  if (exact) return exact;

  const slices = model.model.slices;
  const needle = input.toLowerCase();

  const matches = slices.filter((s) => {
    const k = s.key.toLowerCase();
    return k === needle || k.startsWith(needle.endsWith("-") ? needle : `${needle}-`);
  });

  if (matches.length === 1) {
    console.error(`bridge: resolved slice key "${input}" -> "${matches[0].key}"`);
    return matches[0];
  }
  if (matches.length > 1) {
    throw new BridgeError(
      `Slice key "${input}" is ambiguous: it matches ${matches.length} slices in \`em export\` output. ` +
        `Pass one of the full keys: ${matches.map((s) => s.key).join(", ")}.`
    );
  }

  const near = slices
    .filter((s) => {
      const k = s.key.toLowerCase();
      return needle.length > 0 && (k.includes(needle) || needle.includes(k));
    })
    .map((s) => s.key)
    .slice(0, MAX_SUGGESTIONS);
  const hint =
    near.length > 0
      ? ` Did you mean: ${near.join(", ")}?`
      : slices.length > 0
        ? ` Available keys: ${slices.slice(0, MAX_SUGGESTIONS).map((s) => s.key).join(", ")}${
            slices.length > MAX_SUGGESTIONS ? ", ..." : ""
          }.`
        : "";
  throw new BridgeError(`Slice key "${input}" not found in \`em export\` output.${hint}`);
}
