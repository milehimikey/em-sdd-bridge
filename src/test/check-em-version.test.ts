import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  assertMinimumEmVersion,
  compareSemver,
  getEmVersionRaw,
  MINIMUM_EM_VERSION,
  parseSemver,
} from "../lib/check-em-version.js";
import { BridgeError } from "../lib/bridge-error.js";

function hasEm(): boolean {
  try {
    execFileSync("em", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("parseSemver", () => {
  it("extracts major.minor.patch from a bare version string", () => {
    expect(parseSemver("1.1.1")).toEqual({ major: 1, minor: 1, patch: 1 });
  });

  it("extracts major.minor.patch when surrounded by other text", () => {
    expect(parseSemver("em version 1.6.0")).toEqual({ major: 1, minor: 6, patch: 0 });
  });

  it("returns undefined when no semver-shaped run of digits is present", () => {
    expect(parseSemver("not-a-version")).toBeUndefined();
    expect(parseSemver("")).toBeUndefined();
  });
});

describe("compareSemver", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareSemver({ major: 1, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 })).toBeLessThan(0);
    expect(compareSemver({ major: 1, minor: 2, patch: 0 }, { major: 1, minor: 1, patch: 0 })).toBeGreaterThan(0);
    expect(compareSemver({ major: 1, minor: 1, patch: 1 }, { major: 1, minor: 1, patch: 2 })).toBeLessThan(0);
    expect(compareSemver({ major: 1, minor: 1, patch: 1 }, { major: 1, minor: 1, patch: 1 })).toBe(0);
  });
});

describe("assertMinimumEmVersion", () => {
  it("throws a BridgeError with an actionable message when em is not on PATH", () => {
    expect(() => assertMinimumEmVersion(MINIMUM_EM_VERSION, () => undefined)).toThrow(BridgeError);
    expect(() => assertMinimumEmVersion(MINIMUM_EM_VERSION, () => undefined)).toThrow(
      /not found on PATH.*em-sdd-bridge requires `em` >=1\.7\.0/s
    );
  });

  it("throws a BridgeError when the version output is unparseable", () => {
    expect(() => assertMinimumEmVersion(MINIMUM_EM_VERSION, () => "not-a-version")).toThrow(BridgeError);
    expect(() => assertMinimumEmVersion(MINIMUM_EM_VERSION, () => "not-a-version")).toThrow(
      /Could not parse a semver/
    );
  });

  it("throws a BridgeError when the installed version is below the floor", () => {
    expect(() => assertMinimumEmVersion("1.1.1", () => "1.0.0")).toThrow(BridgeError);
    expect(() => assertMinimumEmVersion("1.1.1", () => "1.0.0")).toThrow(
      /1\.0\.0 is below the minimum supported version 1\.1\.1/
    );
  });

  it("passes when the installed version equals the floor exactly", () => {
    expect(() => assertMinimumEmVersion("1.1.1", () => "1.1.1")).not.toThrow();
  });

  it("passes when the installed version is above the floor", () => {
    expect(() => assertMinimumEmVersion("1.1.1", () => "2.0.0")).not.toThrow();
  });

  // Real, unmocked shell-out to `em --version`, gated like every other
  // em-dependent test in this suite (see em-runner.test.ts / preconditions.test.ts).
  // Skips gracefully in CI, where `em` is deliberately not installed.
  describe.skipIf(!hasEm())("against the real installed `em`", () => {
    it("does not throw for the default MINIMUM_EM_VERSION floor", () => {
      expect(() => assertMinimumEmVersion()).not.toThrow();
    });

    it("getEmVersionRaw returns a parseable semver", () => {
      const raw = getEmVersionRaw();
      expect(raw).toBeDefined();
      expect(parseSemver(raw!)).toBeDefined();
    });

    it("throws when the real installed em is compared against an inflated floor", () => {
      expect(() => assertMinimumEmVersion("999.0.0")).toThrow(BridgeError);
      expect(() => assertMinimumEmVersion("999.0.0")).toThrow(/below the minimum supported version 999\.0\.0/);
    });
  });
});
