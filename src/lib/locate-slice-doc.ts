import { existsSync } from "node:fs";
import path from "node:path";
import { BridgeError } from "./bridge-error.js";
import { findSliceByKey, findSliceDocRelativePath, type ExportedModel } from "./export-model.js";

export interface LocatedSliceDoc {
  key: string;
  relativePath: string; // relative to the .em file's directory, per em-dsl.md `note` semantics
  absolutePath: string;
}

/** Resolve a slice key to its doc path, relative to the directory holding `modelPath`
 *  (the DSL's `note "path.md"` is documented as "Relative to the `.em` file"). */
export function locateSliceDoc(
  model: ExportedModel,
  modelPath: string,
  key: string,
  overrideRelativePath?: string
): LocatedSliceDoc {
  const slice = findSliceByKey(model, key);
  if (!slice) {
    throw new BridgeError(`Slice key "${key}" not found in \`em export\` output.`);
  }
  // --doc override exists because `em export` currently DROPS the `note` binding on
  // elements that also carry a `{ fields }` block (verified live 2026-07-28, em
  // 1.3.0) — field-bearing views/commands lose their doc link in the export, so
  // note-based resolution silently falls back to the slug convention. Filed as an
  // em bug; remove the workaround note when fixed upstream.
  const relativePath = overrideRelativePath ?? findSliceDocRelativePath(slice);
  const modelDir = path.dirname(modelPath);
  const absolutePath = path.resolve(modelDir, relativePath);
  if (!existsSync(absolutePath)) {
    throw new BridgeError(
      `Slice doc for "${key}" not found at ${absolutePath} (resolved from ${
        relativePath === `slices/${key}.md` ? "the slug convention (no note found)" : `note "${relativePath}"`
      }).`
    );
  }
  return { key, relativePath, absolutePath };
}
