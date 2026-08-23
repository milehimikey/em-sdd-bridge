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
  const slice = findSliceByKey(model, key);
  if (!slice) {
    throw new BridgeError(`Slice key "${key}" not found in \`em export\` output.`);
  }

  return { primary: slice };
}
