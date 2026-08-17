import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSliceReady, runEmValidateSliceReady } from "../lib/slice-readiness.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
const modelPath = path.join(fixturesDir, "model.em");

function hasEm(): boolean {
  try {
    execFileSync("em", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("assertSliceReady", () => {
  it("passes silently when the injected run succeeds", () => {
    expect(() => assertSliceReady(modelPath, "record-ping", () => {})).not.toThrow();
  });

  it("throws a BridgeError forwarding the injected run's error message verbatim, unparsed", () => {
    const failure = () => {
      throw new Error(`Command failed: em validate ${modelPath} --slice-ready record-ping\n  warn :12 not ready`);
    };
    expect(() => assertSliceReady(modelPath, "record-ping", failure)).toThrow(BridgeError);
    expect(() => assertSliceReady(modelPath, "record-ping", failure)).toThrow(
      /not ready to implement:\n.*warn :12 not ready/s
    );
  });

  it("stringifies a non-Error thrown by the injected run", () => {
    const failure = () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "not an Error instance";
    };
    expect(() => assertSliceReady(modelPath, "record-ping", failure)).toThrow(/not an Error instance/);
  });

  // Real, unmocked shell-out to `em validate --slice-ready`, gated like every
  // other em-dependent test in this suite. Skips gracefully in CI, where `em`
  // is deliberately not installed.
  describe.skipIf(!hasEm())("against the real installed `em`", () => {
    it("does not throw for a ready slice", () => {
      expect(() => assertSliceReady(modelPath, "record-ping")).not.toThrow();
    });

    it("throws for a slice with no doc bound via note", () => {
      // fixtures/model.em has no slice keyed "does-not-exist".
      expect(() => assertSliceReady(modelPath, "does-not-exist")).toThrow(BridgeError);
    });

    it("runEmValidateSliceReady itself throws (not swallows) on a real failure", () => {
      expect(() => runEmValidateSliceReady(modelPath, "does-not-exist")).toThrow();
    });

    // em prints its diagnostic detail to stderr but the "is NOT
    // ready-to-implement" summary to stdout -- execFileSync's raw
    // Error.message only ever carries stderr, so this proves
    // runEmValidateSliceReady's stdout+stderr stitching actually forwards
    // BOTH, not just whichever stream Node happens to populate by default.
    it("forwards both em's stderr diagnostic AND its stdout summary line", () => {
      expect(() => assertSliceReady(modelPath, "does-not-exist")).toThrow(
        /no slice with export key.*is NOT ready-to-implement/s
      );
    });
  });
});
