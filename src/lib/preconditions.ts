/**
 * Bridge preconditions -- the design-completeness gate and the
 * events-first prerequisite, re-encoded as code (not prose an agent
 * re-derives per run): the gate/prerequisite logic lives in the bridge
 * itself, as tests-backed code, rather than as a policy document an
 * autonomous agent could reinterpret -- or skip -- differently on any given
 * run.
 *
 * Fail-closed: every check in a gate runs regardless of earlier failures in
 * that same gate, and every failure found is reported together in one
 * BridgeError -- a warning is what an autonomous agent walks past; a thrown
 * error is not.
 *
 * Wired into bridge.ts to run BEFORE feature allocation (see runBridge()).
 * This module NEVER creates, offers to create, or scaffolds a missing event
 * type -- on failure the message always directs the user to author the
 * event(s) as real code first.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { BridgeError } from "./bridge-error.js";
import { locateSliceDoc } from "./locate-slice-doc.js";
import type { ExportedModel, ExportedSlice } from "./export-model.js";

const SOURCE_EXTENSIONS = [".kt", ".java", ".ts", ".tsx"];
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "out",
  "target",
  ".git",
  ".gradle",
  ".idea",
  ".specify",
]);

export interface PreconditionOptions {
  /** Consumer project root -- the events-first search tree. */
  repoRoot: string;
  /** Resolved .em model path; its directory is the "component dir" the
   *  design-completeness gate inspects (slices/, typespec/, event model). */
  modelPath: string;
  exportModel: ExportedModel;
  /** The slice(s) being bridged: the sole slice, or [reactor, state-change]
   *  for a validated Automation/Translation pair. */
  slices: ExportedSlice[];
  /** Shared `--doc` override, if the caller passed one. */
  docOverride?: string;
}

/**
 * Runs `npx --no-install tsp <args>`. Deliberately never lets npx fall
 * through to installing from the registry: there is an unrelated,
 * unmaintained `tsp` package on the public npm registry (verified live
 * against a real environment -- NOT @typespec/compiler's `tsp` binary) that
 * a bare `npx tsp` would silently fetch and try to run instead. `--no-install`
 * makes "the real compiler isn't present locally" fail immediately and
 * deterministically, which is what "fail-closed" requires here regardless of
 * network conditions or npm's registry contents.
 */
function runTsp(args: string[], cwd: string): void {
  execFileSync("npx", ["--no-install", "tsp", ...args], { cwd, stdio: "pipe" });
}

/** Mirrors the existing `hasEm()` test-gating pattern: lets the test suite
 *  skip the typespec-compiles-successfully assertion in environments where
 *  the real @typespec/compiler `tsp` binary isn't installed, without ever
 *  weakening the precondition code itself (see checkDesignCompleteness below,
 *  which always treats an unavailable compiler as a FAIL, never a skip). */
export function hasTsp(): boolean {
  try {
    runTsp(["--version"], process.cwd());
    return true;
  } catch {
    return false;
  }
}

function pascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

/** Required events = this slice set's emitted AND consumed event element
 *  names (the slice's emitted/consumed event element names),
 *  PascalCase-normalized ("Ping Recorded" -> "PingRecorded"). Consumed events
 *  surface via a view/processor element's `from` refs in the `em export`
 *  JSON. */
function requiredEventNames(slices: ExportedSlice[]): string[] {
  const names = new Set<string>();
  for (const slice of slices) {
    for (const el of slice.elements) {
      if (el.kind === "event") names.add(el.name);
      if (el.from) for (const ref of el.from) names.add(ref.name);
    }
  }
  return [...names].map(pascalCase).sort();
}

function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (SOURCE_EXTENSIONS.includes(path.extname(full))) {
        out.push(full);
      }
    }
  }
  return out;
}

/** Matches a real type declaration for `name` -- `class X`, `data class X`,
 *  `record X`, `interface X`, `object X`, or TS `type X =`. Deliberately
 *  anchored on these keyword prefixes (not a bare name search) so TypeSpec
 *  models, Avro schemas, event-model entries, and string-literal mentions of
 *  the event name never count -- only .kt/.java/.ts/.tsx files are scanned at
 *  all (see walkSourceFiles), and only these declaration shapes match within
 *  them. */
function typeDeclarationPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b(?:class|interface|object)\\s+${escaped}\\b` +
      `|\\bdata\\s+class\\s+${escaped}\\b` +
      `|\\brecord\\s+${escaped}\\b` +
      `|\\btype\\s+${escaped}\\b\\s*=`
  );
}

/**
 * Strips `// ...` line comments and `/* ... *&#47;` block comments before the
 * declaration regex runs, so a commented-out declaration (e.g.
 * `// class PingRecorded`) never satisfies the events-first gate. Sufficient
 * for the four languages this module scans (.kt/.java/.ts/.tsx all share this
 * comment syntax). Documented approximation, not a full lexer: this does NOT
 * try to distinguish comment markers that appear inside a string or template
 * literal (e.g. a string literal containing `//`) -- a real declaration
 * living only inside a string is not a realistic false-negative concern for
 * source files, and erring toward stripping too much only makes the gate
 * MORE conservative (more likely to report an event missing that a fuller
 * parser would find), never less -- consistent with "fail-closed".
 */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, "");
}

function findEventDeclaration(name: string, searchRoots: string[]): boolean {
  const pattern = typeDeclarationPattern(name);
  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    for (const file of walkSourceFiles(root)) {
      let content: string;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (pattern.test(stripComments(content))) return true;
    }
  }
  return false;
}

/**
 * Best-effort narrowing via `.specify/memory/infrastructure-context.md`: if a
 * line mentions the event name AND a path-shaped token, that token is tried
 * FIRST as a search root. Never authoritative on its own -- callers always
 * widen to a full-tree search before declaring an event missing (a stale or
 * wrong hint can only cost a little time, never produce a false "missing").
 * This default path is a spec-kit convention, not fixed by this module --
 * see README.md for how to point it elsewhere if your project keeps this
 * narrowing hint at a different location.
 */
function infrastructureHint(repoRoot: string, eventName: string): string | undefined {
  const memoPath = path.join(repoRoot, ".specify", "memory", "infrastructure-context.md");
  if (!existsSync(memoPath)) return undefined;
  let content: string;
  try {
    content = readFileSync(memoPath, "utf8");
  } catch {
    return undefined;
  }
  for (const line of content.split("\n")) {
    if (!line.includes(eventName)) continue;
    const pathMatch = line.match(/[.\w-]+(?:\/[.\w-]+)+/);
    if (pathMatch) return path.resolve(repoRoot, pathMatch[0]);
  }
  return undefined;
}

/**
 * The design-completeness gate. Fail-closed: every check below runs
 * regardless of earlier failures; returns the full list (empty = pass) for
 * the caller to combine with checkEventsFirst's failures into one
 * BridgeError. Never throws itself.
 */
export function checkDesignCompleteness(opts: PreconditionOptions): string[] {
  const { modelPath, exportModel, slices, docOverride } = opts;
  const failures: string[] = [];
  const componentDir = path.dirname(modelPath);

  // (a) slice doc(s) resolvable (reuses locate-slice-doc.ts / --doc override).
  for (const slice of slices) {
    try {
      locateSliceDoc(exportModel, modelPath, slice.key, docOverride);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  // (b) exactly one event model in the component dir; .em preferred, .puml is legacy.
  let entries: string[] = [];
  try {
    entries = readdirSync(componentDir);
  } catch {
    failures.push(`Component dir ${componentDir} does not exist or is not readable.`);
  }
  const emFiles = entries.filter((f) => f.endsWith(".em"));
  const pumlFiles = entries.filter((f) => f.endsWith(".puml"));
  if (emFiles.length === 0 && pumlFiles.length > 0) {
    failures.push(
      `Component dir ${componentDir} has only legacy PlantUML event model(s) (${pumlFiles.join(
        ", "
      )}) and no .em file. .em is required as the first-class event-model format -- convert or ` +
        `author the .em model before proceeding.`
    );
  } else if (emFiles.length === 0) {
    failures.push(`Component dir ${componentDir} has no event model (.em or .puml) file.`);
  } else if (emFiles.length > 1) {
    failures.push(
      `Component dir ${componentDir} has ${emFiles.length} .em event models (${emFiles.join(
        ", "
      )}) -- ambiguous which is authoritative. Pass --model to disambiguate.`
    );
  }

  // (c) slices/ dir exists and contains >=1 *.md. A single statSync in a
  // try/catch (not existsSync() followed by a separate statSync() call) --
  // two syscalls have a TOCTOU race window (the path could be deleted or
  // replaced between them), and this function's contract is "never throws":
  // any stat/readdir failure must become a collected failure, not an
  // uncaught exception.
  const slicesDir = path.join(componentDir, "slices");
  let slicesStat: ReturnType<typeof statSync> | undefined;
  try {
    slicesStat = statSync(slicesDir);
  } catch {
    // Covers both "doesn't exist" (ENOENT, the common case) and a permission
    // error reading the path's metadata -- both fall through to the same
    // "has no slices/ directory" failure below, matching this module's
    // existing style for the componentDir readdirSync guard above.
  }
  if (!slicesStat || !slicesStat.isDirectory()) {
    failures.push(`Component dir ${componentDir} has no slices/ directory.`);
  } else {
    try {
      const mdFiles = readdirSync(slicesDir).filter((f) => f.endsWith(".md"));
      if (mdFiles.length === 0) {
        failures.push(`slices/ directory at ${slicesDir} contains no *.md slice docs.`);
      }
    } catch (err) {
      // e.g. a permissions error reading the directory's contents even
      // though stat-ing the directory itself succeeded above.
      failures.push(
        `slices/ directory at ${slicesDir} is unreadable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // (d) typespec/main.tsp exists, and (e) it compiles -- a missing/unavailable
  // compiler is itself a FAIL, never a skip.
  const typespecDir = path.join(componentDir, "typespec");
  const mainTsp = path.join(typespecDir, "main.tsp");
  if (!existsSync(mainTsp)) {
    failures.push(`No typespec/main.tsp found at ${mainTsp}.`);
  } else {
    try {
      runTsp(["compile", "main.tsp", "--no-emit"], typespecDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`\`npx tsp compile main.tsp --no-emit\` failed in ${typespecDir}: ${message}`);
    }
  }

  return failures;
}

/**
 * Events-first prerequisite. Fail-closed: checks every required event
 * regardless of earlier misses, and lists every missing one together. Never
 * throws itself; never creates, offers to create, or scaffolds a missing
 * event -- the message only ever points at authoring the event as real
 * code.
 */
export function checkEventsFirst(opts: PreconditionOptions): string[] {
  const { repoRoot, slices } = opts;
  const required = requiredEventNames(slices);
  const missing: string[] = [];
  for (const name of required) {
    const hint = infrastructureHint(repoRoot, name);
    const searchRoots = hint ? [hint, repoRoot] : [repoRoot];
    if (!findEventDeclaration(name, searchRoots)) {
      missing.push(name);
    }
  }
  if (missing.length === 0) return [];
  return [
    `Missing event type declaration(s) required by this slice: ${missing.join(", ")}. ` +
      `Author these as real code (a class/data class/record/interface/object declaration, or a ` +
      `TS type alias, in the consumer's .kt/.java/.ts/.tsx source tree) before running the bridge ` +
      `-- the bridge never creates, offers to create, or scaffolds event types for you.`,
  ];
}

/**
 * Runs both preconditions and throws ONE BridgeError listing every failure
 * from both gates, or returns silently if everything passes.
 */
export function assertPreconditions(opts: PreconditionOptions): void {
  const failures = [...checkDesignCompleteness(opts), ...checkEventsFirst(opts)];
  if (failures.length === 0) return;
  throw new BridgeError(
    `Design-completeness / events-first preconditions failed (${failures.length}):\n` +
      failures.map((f) => `  - ${f}`).join("\n")
  );
}
