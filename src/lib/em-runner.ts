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

/** Run `em slice mark-implemented <modelPath> <key> <prUrl>` -- MIL-104, the
 *  write-side mirror of `assertSliceReady`/`runEmValidateSliceReady`
 *  (slice-readiness.ts) delegating the readiness *read* to `em`: one writer
 *  implementation (em's own frontmatter writer, MIL-103), not two. This
 *  bridge no longer edits a slice doc's status/PR-link fields itself at all.
 *
 *  em prints its result (or refusal) entirely to one stream at a time --
 *  success text to stdout, failure text to stderr (verified against em
 *  1.8.0; unlike `em validate --slice-ready`, there is no split-stream case
 *  here to stitch together) -- and execFileSync's thrown Error.message
 *  already carries stderr verbatim (Node's default sync-exec error
 *  formatting), so wrapping `err.message` as-is, the same as runEmExport
 *  above, is enough to forward em's diagnostic text unmodified. Returns
 *  em's stdout, trimmed, on success; never parsed beyond that -- em owns
 *  the message format and can change it freely. */
export function runEmMarkImplemented(modelPath: string, key: string, prUrl: string): string {
  try {
    return execFileSync("em", ["slice", "mark-implemented", modelPath, key, prUrl], { encoding: "utf8" }).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BridgeError(`\`em slice mark-implemented ${modelPath} ${key} ${prUrl}\` failed: ${message}`);
  }
}
