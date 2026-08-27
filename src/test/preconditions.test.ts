import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPreconditions,
  checkDesignCompleteness,
  checkEventsFirst,
  hasTsp,
} from "../lib/preconditions.js";
import { findSliceByKey, type ExportedModel, type ExportedSlice } from "../lib/export-model.js";
import { runBridge } from "../bridge.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
const modelPath = path.join(fixturesDir, "model.em");
const exportModel: ExportedModel = JSON.parse(readFileSync(path.join(fixturesDir, "export.json"), "utf8"));

function hasEm(): boolean {
  try {
    execFileSync("em", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

/** A temp component dir: model.em + slices/ copied from the real Ping
 *  fixture (so slice docs resolve), optionally with typespec/ copied too. */
function buildComponentDir(opts: { withTypespec: boolean }): string {
  const dir = mkTmp("bridge-preconditions-component-");
  cpSync(modelPath, path.join(dir, "model.em"));
  cpSync(path.join(fixturesDir, "slices"), path.join(dir, "slices"), { recursive: true });
  if (opts.withTypespec) {
    cpSync(path.join(fixturesDir, "typespec"), path.join(dir, "typespec"), { recursive: true });
  }
  return dir;
}

/** Seeds `repoRoot/.specify/scripts/bash/` with the real, pinned,
 *  verified-compatible core script (+ its common.sh) from the good
 *  fixture -- so runBridge's scaffold flag-compatibility check
 *  (lib/check-speckit-scaffold.ts, runs before design-completeness) passes
 *  and the tests below reach the design-completeness / events-first checks
 *  they actually mean to exercise. */
function seedSpeckitScaffold(repoRoot: string): void {
  const destDir = path.join(repoRoot, ".specify", "scripts", "bash");
  mkdirSync(destDir, { recursive: true });
  for (const file of ["create-new-feature.sh", "common.sh"]) {
    cpSync(path.join(fixturesDir, "speckit-scripts", ".specify", "scripts", "bash", file), path.join(destDir, file));
  }
}

function recordPingSlice(): ExportedSlice {
  return findSliceByKey(exportModel, "record-ping")!;
}

describe("hasTsp", () => {
  it("returns a boolean without throwing", () => {
    expect(() => hasTsp()).not.toThrow();
    expect(typeof hasTsp()).toBe("boolean");
  });
});

describe("checkDesignCompleteness", () => {
  it("flags an unresolvable slice doc", () => {
    const componentDir = buildComponentDir({ withTypespec: true });
    const fabricatedModel: ExportedModel = {
      ...exportModel,
      model: {
        ...exportModel.model,
        slices: [{ key: "no-such-slice", name: "No Such Slice", index: 99, line: 1, elements: [] }],
      },
    };
    const failures = checkDesignCompleteness({
      repoRoot: componentDir,
      modelPath: path.join(componentDir, "model.em"),
      exportModel: fabricatedModel,
      slices: [fabricatedModel.model.slices[0]],
    });
    expect(failures.some((f) => /not found at/.test(f))).toBe(true);
  });

  it("flags a component dir with no event model at all", () => {
    const dir = mkTmp("bridge-preconditions-no-model-");
    mkdirSync(path.join(dir, "slices"), { recursive: true });
    writeFileSync(path.join(dir, "slices", "x.md"), "# Slice: X\n");
    const failures = checkDesignCompleteness({
      repoRoot: dir,
      modelPath: path.join(dir, "model.em"), // does not exist
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /no event model/i.test(f))).toBe(true);
  });

  it("flags a component dir with only a legacy .puml event model", () => {
    const dir = mkTmp("bridge-preconditions-puml-only-");
    writeFileSync(path.join(dir, "legacy.puml"), "@startuml\n@enduml\n");
    mkdirSync(path.join(dir, "slices"), { recursive: true });
    writeFileSync(path.join(dir, "slices", "x.md"), "# Slice: X\n");
    const failures = checkDesignCompleteness({
      repoRoot: dir,
      modelPath: path.join(dir, "model.em"), // referenced but absent; .puml exists instead
      exportModel,
      slices: [recordPingSlice()],
    });
    const failure = failures.find((f) => /legacy PlantUML/.test(f));
    expect(failure).toBeDefined();
    expect(failure).toMatch(/legacy\.puml/);
  });

  it("flags multiple .em event models as ambiguous", () => {
    const dir = mkTmp("bridge-preconditions-multi-em-");
    writeFileSync(path.join(dir, "a.em"), 'model "A"\n');
    writeFileSync(path.join(dir, "b.em"), 'model "B"\n');
    mkdirSync(path.join(dir, "slices"), { recursive: true });
    writeFileSync(path.join(dir, "slices", "x.md"), "# Slice: X\n");
    const failures = checkDesignCompleteness({
      repoRoot: dir,
      modelPath: path.join(dir, "a.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /ambiguous which is authoritative/.test(f))).toBe(true);
  });

  it("flags a missing slices/ directory", () => {
    const dir = mkTmp("bridge-preconditions-no-slices-dir-");
    cpSync(modelPath, path.join(dir, "model.em"));
    const failures = checkDesignCompleteness({
      repoRoot: dir,
      modelPath: path.join(dir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /no slices\/ directory/.test(f))).toBe(true);
  });

  // checkDesignCompleteness must never throw, even for stat-able-but-not-a-directory
  // paths. A real permissions failure isn't portably simulatable in a unit
  // test, so this proves the single-statSync-in-try/catch refactor's happy
  // path (statSync succeeds, isDirectory() is false) doesn't throw and still
  // reports a failure -- the true permission-error branch is covered by code
  // review (the guard) only, not by an automated test.
  it("treats slices/ existing as a FILE (not a directory) as missing, without throwing", () => {
    const dir = mkTmp("bridge-preconditions-slices-is-file-");
    cpSync(modelPath, path.join(dir, "model.em"));
    writeFileSync(path.join(dir, "slices"), "not a directory\n");
    expect(() =>
      checkDesignCompleteness({
        repoRoot: dir,
        modelPath: path.join(dir, "model.em"),
        exportModel,
        slices: [recordPingSlice()],
      })
    ).not.toThrow();
    const failures = checkDesignCompleteness({
      repoRoot: dir,
      modelPath: path.join(dir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /no slices\/ directory/.test(f))).toBe(true);
  });

  it("flags an empty slices/ directory (no *.md files)", () => {
    const dir = mkTmp("bridge-preconditions-empty-slices-dir-");
    cpSync(modelPath, path.join(dir, "model.em"));
    mkdirSync(path.join(dir, "slices"));
    writeFileSync(path.join(dir, "slices", "not-markdown.txt"), "nope\n");
    const failures = checkDesignCompleteness({
      repoRoot: dir,
      modelPath: path.join(dir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /contains no \*\.md slice docs/.test(f))).toBe(true);
  });

  it("flags a missing typespec/main.tsp", () => {
    const componentDir = buildComponentDir({ withTypespec: false });
    const failures = checkDesignCompleteness({
      repoRoot: componentDir,
      modelPath: path.join(componentDir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /No typespec\/main\.tsp found/.test(f))).toBe(true);
  });

  // Exactly one of these two runs, depending on whether the real
  // @typespec/compiler `tsp` binary happens to be installed in the
  // environment running the suite. The precondition code itself is
  // fail-closed either way; only which branch of THIS test executes is
  // environment dependent.
  describe.skipIf(hasTsp())("when the TypeSpec compiler is unavailable", () => {
    it("treats an unavailable compiler as a FAIL, not a skip", () => {
      const componentDir = buildComponentDir({ withTypespec: true });
      const failures = checkDesignCompleteness({
        repoRoot: componentDir,
        modelPath: path.join(componentDir, "model.em"),
        exportModel,
        slices: [recordPingSlice()],
      });
      expect(failures.some((f) => /npx tsp compile main\.tsp --no-emit.*failed/.test(f))).toBe(true);
    });
  });

  describe.skipIf(!hasTsp())("when the TypeSpec compiler is available", () => {
    it("passes every check for a fully valid component dir", () => {
      const componentDir = buildComponentDir({ withTypespec: true });
      const failures = checkDesignCompleteness({
        repoRoot: componentDir,
        modelPath: path.join(componentDir, "model.em"),
        exportModel,
        slices: [recordPingSlice()],
      });
      expect(failures).toEqual([]);
    });
  });
});

describe("checkEventsFirst", () => {
  it("passes when every required event has a matching type declaration", () => {
    const dir = mkTmp("bridge-events-first-present-");
    writeFileSync(
      path.join(dir, "PingRecorded.kt"),
      "data class PingRecorded(val postedAt: String, val source: String)\n"
    );
    const failures = checkEventsFirst({
      repoRoot: dir,
      modelPath,
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures).toEqual([]);
  });

  it("matches a TS type alias declaration too", () => {
    const dir = mkTmp("bridge-events-first-ts-alias-");
    writeFileSync(path.join(dir, "events.ts"), "export type PingRecorded = { postedAt: string; source: string };\n");
    const failures = checkEventsFirst({
      repoRoot: dir,
      modelPath,
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures).toEqual([]);
  });

  it("does not false-positive on a longer identifier sharing the same prefix", () => {
    const dir = mkTmp("bridge-events-first-prefix-");
    writeFileSync(path.join(dir, "PingRecordedV2.kt"), "class PingRecordedV2(val postedAt: String)\n");
    const failures = checkEventsFirst({
      repoRoot: dir,
      modelPath,
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/PingRecorded/);
  });

  it("ignores a bare string-literal mention (not a type declaration)", () => {
    const dir = mkTmp("bridge-events-first-string-literal-");
    writeFileSync(path.join(dir, "notes.ts"), 'export const label = "PingRecorded";\n');
    const failures = checkEventsFirst({
      repoRoot: dir,
      modelPath,
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.length).toBe(1);
  });

  // The declaration regex was once tested against raw file content, so a
  // commented-out declaration satisfied the gate even though no real type
  // exists. Comments (both line and block) must be stripped before matching.
  it("does not count a commented-out declaration (// line comment)", () => {
    const dir = mkTmp("bridge-events-first-line-comment-");
    writeFileSync(
      path.join(dir, "PingRecorded.kt"),
      "// TODO: bring this back once the schema stabilizes\n" +
        "// data class PingRecorded(val postedAt: String, val source: String)\n"
    );
    const failures = checkEventsFirst({
      repoRoot: dir,
      modelPath,
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/PingRecorded/);
  });

  it("does not count a commented-out declaration (/* block comment */)", () => {
    const dir = mkTmp("bridge-events-first-block-comment-");
    writeFileSync(
      path.join(dir, "PingRecorded.ts"),
      "/*\n * type PingRecorded = { postedAt: string; source: string };\n */\n"
    );
    const failures = checkEventsFirst({
      repoRoot: dir,
      modelPath,
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/PingRecorded/);
  });

  it("still finds a real declaration alongside an unrelated comment mentioning the name", () => {
    const dir = mkTmp("bridge-events-first-comment-plus-real-");
    writeFileSync(
      path.join(dir, "PingRecorded.kt"),
      "// see PingRecorded for the schema\n" +
        "data class PingRecorded(val postedAt: String, val source: String)\n"
    );
    const failures = checkEventsFirst({
      repoRoot: dir,
      modelPath,
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures).toEqual([]);
  });

  it("lists every missing event when none are found, and never offers to create them", () => {
    const dir = mkTmp("bridge-events-first-missing-");
    const pingsToNotify = findSliceByKey(exportModel, "pings-to-notify")!;
    const sendNotification = findSliceByKey(exportModel, "send-notification")!;
    const failures = checkEventsFirst({
      repoRoot: dir,
      modelPath,
      exportModel,
      slices: [pingsToNotify, sendNotification],
    });
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/PingRecorded/);
    expect(failures[0]).toMatch(/NotificationSent/);
    expect(failures[0]).toMatch(/never creates, offers to create, or scaffolds/i);
    expect(failures[0]).toMatch(/Author these as real code/i);
  });
});

describe("assertPreconditions", () => {
  it("throws one BridgeError combining design-completeness and events-first failures", () => {
    const componentDir = buildComponentDir({ withTypespec: false }); // fails (d)
    const emptyRepo = mkTmp("bridge-preconditions-combined-"); // fails events-first too
    try {
      assertPreconditions({
        repoRoot: emptyRepo,
        modelPath: path.join(componentDir, "model.em"),
        exportModel,
        slices: [recordPingSlice()],
      });
      expect.fail("expected assertPreconditions to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeError);
      const message = (err as BridgeError).message;
      expect(message).toMatch(/No typespec\/main\.tsp found/);
      expect(message).toMatch(/Missing event type declaration/);
    }
  });

  // Gated like the checkDesignCompleteness "compiler available" test above:
  // a full pass requires @typespec/compiler's real `tsp` binary, which this
  // environment does not have installed.
  describe.skipIf(!hasTsp())("when every precondition is satisfiable", () => {
    it("returns without throwing", () => {
      const componentDir = buildComponentDir({ withTypespec: true });
      writeFileSync(
        path.join(componentDir, "PingRecorded.kt"),
        "data class PingRecorded(val postedAt: String, val source: String)\n"
      );
      expect(() =>
        assertPreconditions({
          repoRoot: componentDir,
          modelPath: path.join(componentDir, "model.em"),
          exportModel,
          slices: [recordPingSlice()],
        })
      ).not.toThrow();
    });
  });
});

// Proves the design-completeness / events-first gate is actually wired into
// runBridge() and fail-closed BY DEFAULT (no --skip-design-gate) -- not just
// implemented as inert library code. Uses substring assertions against the
// combined BridgeError message rather than isolating a single failure, since
// other, unrelated checks (e.g. the TypeSpec compile step, when the compiler
// isn't installed) may also legitimately fail at the same time -- that's the
// intended fail-closed, collect-everything behavior, not test noise.
describe.skipIf(!hasEm())("runBridge wiring (no --skip-design-gate)", () => {
  it("refuses when the component dir has no typespec/main.tsp", () => {
    const componentDir = buildComponentDir({ withTypespec: false });
    const repoRoot = mkTmp("bridge-wiring-repo-");
    seedSpeckitScaffold(repoRoot);
    expect(() =>
      runBridge(["record-ping", "--repo-root", repoRoot, "--model", path.join(componentDir, "model.em")])
    ).toThrow(/No typespec\/main\.tsp found/);
  });

  it("refuses when a required event has no type declaration anywhere in the consumer tree", () => {
    const componentDir = buildComponentDir({ withTypespec: true });
    const repoRoot = mkTmp("bridge-wiring-repo-"); // no .kt/.ts files at all
    seedSpeckitScaffold(repoRoot);
    expect(() =>
      runBridge(["record-ping", "--repo-root", repoRoot, "--model", path.join(componentDir, "model.em")])
    ).toThrow(/Missing event type declaration.*PingRecorded/s);
  });

  it("prints a loud warning and bypasses both checks when --skip-design-gate is passed", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const componentDir = buildComponentDir({ withTypespec: false }); // would otherwise fail (d) and events-first
    // Needs a real .specify/ (with the core create-new-feature.sh) for
    // allocation to succeed -- --skip-design-gate only bypasses the
    // design-completeness / events-first preconditions, not feature
    // allocation itself. --dry-run keeps this read-only.
    const repoRoot = path.join(fixturesDir, "speckit-scripts");

    let result;
    expect(() => {
      result = runBridge([
        "record-ping",
        "--repo-root",
        repoRoot,
        "--model",
        path.join(componentDir, "model.em"),
        "--dry-run",
        "--skip-design-gate",
      ]);
    }).not.toThrow();
    expect(result).toBeDefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/WARNING.*--skip-design-gate/s));
  });
});

describe("contractSource configuration (.specify/em-sdd.json)", () => {
  function withConfig(componentDir: string, contents: string): string {
    // repoRoot and componentDir coincide in these tests (matching the
    // missing-typespec test above); the config lives under repoRoot.
    mkdirSync(path.join(componentDir, ".specify"), { recursive: true });
    writeFileSync(path.join(componentDir, ".specify", "em-sdd.json"), contents);
    return componentDir;
  }

  it('"contractSource": "none" skips ONLY the TypeSpec checks', () => {
    const componentDir = buildComponentDir({ withTypespec: false });
    withConfig(componentDir, JSON.stringify({ contractSource: "none" }));
    const failures = checkDesignCompleteness({
      repoRoot: componentDir,
      modelPath: path.join(componentDir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /typespec/i.test(f))).toBe(false);
    // The rest of the gate still ran and passed on this valid component dir.
    expect(failures).toEqual([]);
  });

  it('"contractSource": "none" leaves the other checks intact (missing slices/ still fails)', () => {
    const componentDir = buildComponentDir({ withTypespec: false });
    withConfig(componentDir, JSON.stringify({ contractSource: "none" }));
    rmSync(path.join(componentDir, "slices"), { recursive: true, force: true });
    const failures = checkDesignCompleteness({
      repoRoot: componentDir,
      modelPath: path.join(componentDir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /no slices\/ directory/.test(f))).toBe(true);
  });

  it("an unknown contractSource value is a gate FAILURE, and the TypeSpec checks still run", () => {
    const componentDir = buildComponentDir({ withTypespec: false });
    withConfig(componentDir, JSON.stringify({ contractSource: "openapi" }));
    const failures = checkDesignCompleteness({
      repoRoot: componentDir,
      modelPath: path.join(componentDir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /unknown "contractSource" value "openapi"/.test(f))).toBe(true);
    expect(failures.some((f) => /No typespec\/main\.tsp found/.test(f))).toBe(true);
  });

  it("malformed em-sdd.json is a gate FAILURE (fail-closed), never a silent fallback", () => {
    const componentDir = buildComponentDir({ withTypespec: false });
    withConfig(componentDir, "{ not json");
    const failures = checkDesignCompleteness({
      repoRoot: componentDir,
      modelPath: path.join(componentDir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /not valid JSON/.test(f))).toBe(true);
  });

  it("absent config keeps the default: TypeSpec checks required (unchanged behavior)", () => {
    const componentDir = buildComponentDir({ withTypespec: false });
    const failures = checkDesignCompleteness({
      repoRoot: componentDir,
      modelPath: path.join(componentDir, "model.em"),
      exportModel,
      slices: [recordPingSlice()],
    });
    expect(failures.some((f) => /No typespec\/main\.tsp found/.test(f))).toBe(true);
  });
});
