import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { BridgeError } from "./bridge-error.js";
import type { ExportedModel } from "./export-model.js";

/** Resolve the `.em` model to run `em export` against. Explicit `override` wins;
 *  otherwise the sole `*.em` file at the repo root (no project-specific naming
 *  convention is assumed -- name your model whatever fits your project). An
 *  absolute `override` is used as-is; a relative one is resolved against
 *  `repoRoot`, NOT `process.cwd()` -- `path.resolve(override)` alone would
 *  silently resolve against the invoking shell's cwd, which usually isn't
 *  the repo root the rest of the bridge (allocateFeature, the events-first
 *  source-tree search) operates against. */
export function resolveModelPath(repoRoot: string, override?: string): string {
  if (override) return path.isAbsolute(override) ? override : path.resolve(repoRoot, override);
  const candidates = readdirSync(repoRoot).filter((f) => f.endsWith(".em"));
  if (candidates.length === 1) return path.join(repoRoot, candidates[0]);
  throw new BridgeError(
    `Could not find a unique .em model at repo root ${repoRoot} (found ${candidates.length} ` +
      `\`*.em\` files). Pass --model explicitly.`
  );
}

/** Run `em export <modelPath>` and parse its JSON. */
export function runEmExport(modelPath: string): ExportedModel {
  let stdout: string;
  try {
    stdout = execFileSync("em", ["export", modelPath], { encoding: "utf8" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BridgeError(`\`em export ${modelPath}\` failed: ${message}`);
  }
  try {
    return JSON.parse(stdout) as ExportedModel;
  } catch {
    throw new BridgeError(`\`em export ${modelPath}\` did not produce valid JSON.`);
  }
}
