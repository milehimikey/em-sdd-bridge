/**
 * How the design-completeness gate finds and runs the TypeSpec compiler
 * (#25), and how it explains a failure.
 *
 * The gate used to run `npx --no-install tsp` with cwd = `<model>/typespec`
 * and assume `@typespec/compiler` (and libraries such as `@typespec/http`)
 * resolve from there. Consumer repos often have no package.json or
 * node_modules at or above that directory -- TypeSpec comes from a toolchain
 * manager, or a global or cached install -- so npx would pick up a stale
 * cached `tsp` with a broken interpreter path, or the compile failed on an
 * unresolvable library import even though the TypeSpec was valid, and the
 * same machine could pass the gate for one model and fail it for another
 * (npx resolves relative to cwd). Each failure surfaced as one opaque exec
 * error, and the gate cannot be skipped, so the bridge was blocked outright.
 *
 * Resolution order:
 *   1. `"tspCommand"` from `.specify/em-sdd.json` (an argv prefix, e.g.
 *      `["mise", "exec", "--", "tsp"]` or `["/path/to/tsp"]`) -- repo policy,
 *      committed and reviewed like every other key there.
 *   2. The nearest `node_modules/.bin/tsp`, walking up from the typespec dir
 *      to the repo root (inclusive) -- a locally installed compiler is found
 *      wherever the repo keeps it, not only at the typespec dir.
 *   3. `npx --no-install tsp`, the historical default. `--no-install` is
 *      kept deliberately: there is an unrelated, unmaintained `tsp` package
 *      on the public npm registry (npx names it: "missing packages ...
 *      tsp@0.0.1") that a bare `npx tsp` would fetch and run instead.
 *      "The real compiler isn't present" must fail immediately and
 *      deterministically, regardless of network or registry contents.
 *
 * Failures are classified so the message names the cause and the fix:
 *   - not-runnable: the command could not be executed at all (ENOENT, bad
 *     interpreter, exit 126/127, npx's missing-package refusal).
 *   - library-unresolvable: the compiler ran but an import such as
 *     `@typespec/http` did not resolve from the typespec dir.
 *   - compile-errors: the compiler ran and the TypeSpec itself is wrong.
 * Fail-closed throughout: every path is a failure the gate reports; nothing
 * here downgrades to a warning or a skip.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type TspResolutionSource = "config" | "local-bin" | "npx";

export interface TspResolution {
  /** argv prefix; the compile args are appended. */
  command: string[];
  source: TspResolutionSource;
}

export interface ResolveTspOptions {
  /** `<model>/typespec` -- where the compile runs and where the walk starts. */
  typespecDir: string;
  /** Where the walk stops (inclusive). */
  repoRoot: string;
  /** `"tspCommand"` from .specify/em-sdd.json, already validated. */
  configured?: string[];
}

export const NPX_TSP: readonly string[] = ["npx", "--no-install", "tsp"];

export function resolveTspCommand(opts: ResolveTspOptions): TspResolution {
  if (opts.configured && opts.configured.length > 0) {
    return { command: [...opts.configured], source: "config" };
  }
  const local = findLocalTsp(opts.typespecDir, opts.repoRoot);
  if (local) return { command: [local], source: "local-bin" };
  return { command: [...NPX_TSP], source: "npx" };
}

/** Nearest `node_modules/.bin/tsp` from `start` up to `stop` (inclusive).
 *  If `start` is not under `stop` the walk continues to the filesystem root
 *  so an out-of-tree model dir still finds its own install. */
function findLocalTsp(start: string, stop: string): string | undefined {
  const stopResolved = path.resolve(stop);
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, "node_modules", ".bin", "tsp");
    if (existsSync(candidate)) return candidate;
    if (dir === stopResolved) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export type TspFailureKind = "not-runnable" | "library-unresolvable" | "compile-errors";

export type TspRunResult =
  | { ok: true }
  | { ok: false; kind: TspFailureKind; /** Gate-ready failure text: cause + fix. */ message: string };

/** The real `execFileSync` shape this module relies on; injectable for tests
 *  that want to simulate exec failures without a real process. */
export type ExecFileSyncLike = (file: string, args: string[], options: { cwd: string; stdio: "pipe" }) => unknown;

interface ExecError {
  code?: string;
  status?: number | null;
  stdout?: unknown;
  stderr?: unknown;
  message?: string;
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function firstLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

const NOT_RUNNABLE_RE =
  /bad interpreter|command not found|could not determine executable to run|npx canceled due to missing packages|No such file or directory/i;
/** TypeSpec: `error import-not-found: Couldn't resolve import "@typespec/http"`;
 *  Node: `Cannot find package '@typespec/http'` / `Cannot find module '...'`. */
const LIBRARY_RE = /import-not-found|Couldn't resolve import|Cannot find (?:package|module)/i;
const LIBRARY_NAME_RE = /(?:Couldn't resolve import|Cannot find (?:package|module))\s+["']([^"']+)["']/i;

export const TSP_CONFIG_HINT =
  `set "tspCommand" in .specify/em-sdd.json to the compiler your toolchain provides ` +
  `(an argv array, e.g. ["mise", "exec", "--", "tsp"] or ["/path/to/tsp"])`;

/** Runs `<command> compile main.tsp --no-emit` (or `extraArgs`) in
 *  `typespecDir`; never throws. */
export function runTspCompile(
  resolution: TspResolution,
  typespecDir: string,
  extraArgs: string[] = ["compile", "main.tsp", "--no-emit"],
  exec: ExecFileSyncLike = execFileSync as unknown as ExecFileSyncLike
): TspRunResult {
  const [file, ...prefix] = resolution.command;
  const args = [...prefix, ...extraArgs];
  const shown = `${[file, ...args].join(" ")}`;
  const via =
    resolution.source === "config"
      ? '"tspCommand" from .specify/em-sdd.json'
      : resolution.source === "local-bin"
        ? "the nearest node_modules/.bin/tsp"
        : "npx (no tspCommand configured, no node_modules/.bin/tsp found between the typespec dir and the repo root)";
  try {
    exec(file, args, { cwd: typespecDir, stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    const e = (err ?? {}) as ExecError;
    const stderr = text(e.stderr);
    const stdout = text(e.stdout);
    const output = [stderr, stdout].filter(Boolean).join("\n");
    const detail = output || text(e.message);

    const notRunnable =
      e.code === "ENOENT" || e.status === 126 || e.status === 127 || (!!output && NOT_RUNNABLE_RE.test(output));
    if (notRunnable) {
      // ENOENT covers both "no such executable" and "its #! interpreter is
      // missing" (the stale-npx-cache symptom); Node's own `spawnSync ...
      // ENOENT` text is not a cause a reader can act on, so say it plainly.
      const cause =
        e.code === "ENOENT"
          ? `the executable \`${file}\` does not exist or its interpreter is missing`
          : firstLine(detail) || "the process could not be started";
      return {
        ok: false,
        kind: "not-runnable",
        message:
          `TypeSpec compiler not runnable: \`${shown}\` (resolved via ${via}) in ${typespecDir}: ${cause}. ` +
          `Install @typespec/compiler where the repo can find it (node_modules at or above the typespec dir), or ${TSP_CONFIG_HINT}. ` +
          `A stale npx cache can also cause this; clear it or configure tspCommand.`,
      };
    }
    if (LIBRARY_RE.test(output)) {
      const lib = output.match(LIBRARY_NAME_RE)?.[1];
      return {
        ok: false,
        kind: "library-unresolvable",
        message:
          `TypeSpec library ${lib ? `${lib} ` : ""}not resolvable from ${typespecDir} (compiler: \`${shown}\`, via ${via}): ` +
          `${firstLine(output)}. The TypeSpec may well be valid; the compiler cannot find the library from this directory. ` +
          `Install it where the compiler resolves packages (a package.json + node_modules at or above ${typespecDir}), ` +
          `or ${TSP_CONFIG_HINT} whose environment provides it.`,
      };
    }
    return {
      ok: false,
      kind: "compile-errors",
      message: `TypeSpec compile errors in ${typespecDir} (\`${shown}\`, via ${via}):\n${detail || "(no output)"}`,
    };
  }
}
