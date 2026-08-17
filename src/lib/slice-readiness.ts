/**
 * Slice readiness gate (MIL-94), fully delegated to `em validate --slice-ready`
 * (MIL-87, em >=1.7.0) -- one gate implementation, not two. `em validate
 * <modelPath> --slice-ready <key>` has no `--json` output: text diagnostics +
 * exit code only (0 = ready, non-zero = not ready). This module never parses
 * or branches on that text -- only the exit code decides pass/fail; on
 * failure, em's own stdout+stderr is forwarded verbatim into the thrown
 * BridgeError, the same forwarding spirit em-runner.ts's runEmExport already
 * uses for `em export` failures.
 *
 * The bridge's own former readiness predicate (status === "ready-to-implement"
 * AND every Open Question checked, previously slice-doc.ts's
 * assertReadyToImplement) is retired: em's `--slice-ready` evaluates the
 * SAME rule server-side, against the model's own note-bound doc for the
 * given key -- independent of this bridge's `--doc` override, which only
 * ever affected which file *this bridge* reads/links, never what em judges
 * ready. A slice doc reachable only via a non-convention note path reads as
 * "no doc bound" to em's readiness check exactly as it does to `em export`'s
 * doc join -- no bridge-side fallback for that gap; see export-model.ts's
 * module doc comment.
 */

import { execFileSync } from "node:child_process";
import { BridgeError } from "./bridge-error.js";

/** Runs `em validate <modelPath> --slice-ready <key>`, discarding its
 *  stdout/stderr on success. Injectable (default: the real execFileSync
 *  call) so assertSliceReady's forwarding behavior is unit-testable without
 *  a real `em` binary in a specific not-ready state -- mirrors
 *  check-em-version.ts's injectable getVersionRaw.
 *
 *  em prints its per-diagnostic detail lines to stderr (console.warn/
 *  console.error) but the summary sentence ("slice X is NOT
 *  ready-to-implement") to stdout (console.log) -- execFileSync's thrown
 *  Error.message only ever contains stderr, so on failure this re-throws
 *  with BOTH streams stitched into `.message`, giving assertSliceReady one
 *  place to read the complete forwarded text from. */
export function runEmValidateSliceReady(modelPath: string, key: string): void {
  try {
    execFileSync("em", ["validate", modelPath, "--slice-ready", key], { encoding: "utf8" });
  } catch (err) {
    if (err instanceof Error && "stdout" in err && "stderr" in err) {
      // stderr (em's per-diagnostic warn/error lines) first, then stdout (the
      // "is NOT ready-to-implement" summary) -- the same order em itself
      // prints them to a real terminal.
      const stderr = String((err as { stderr?: string }).stderr ?? "").trim();
      const stdout = String((err as { stdout?: string }).stdout ?? "").trim();
      const stitched = [stderr, stdout].filter(Boolean).join("\n");
      // Only overwrite if there's actually something to show -- a total spawn
      // failure (e.g. `em` disappearing from PATH mid-run) leaves both empty,
      // and the original Error.message (e.g. "spawnSync em ENOENT") is more
      // informative than blanking it out.
      if (stitched) err.message = stitched;
    }
    throw err;
  }
}

/**
 * Fail-closed: throws a BridgeError (never a raw Error) when `em validate
 * --slice-ready` exits non-zero, forwarding its own diagnostic text
 * unmodified. Returns silently when the slice is ready.
 */
export function assertSliceReady(
  modelPath: string,
  key: string,
  run: (modelPath: string, key: string) => void = runEmValidateSliceReady
): void {
  try {
    run(modelPath, key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BridgeError(
      `\`em validate ${modelPath} --slice-ready ${key}\` reports "${key}" is not ready to implement:\n${message}`
    );
  }
}
