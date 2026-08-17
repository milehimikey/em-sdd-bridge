/**
 * Minimum-`em`-version check. Shells out to `em --version` (same pattern
 * em-runner.ts uses for shelling out to `em`), parses the semver, and
 * compares it against a supported floor.
 *
 * Fail-closed, mirroring the style already used in lib/preconditions.ts:
 * a missing or too-old `em` is reported plainly, as a BridgeError with an
 * actionable message -- this module never tries to auto-install or
 * auto-upgrade `em` for you.
 *
 * The floor tracks the `em` version this bridge was last verified against.
 * Bump MINIMUM_EM_VERSION deliberately when a newer `em` feature this bridge
 * starts depending on ships -- it is not derived automatically from
 * anything at build or run time.
 */

import { execFileSync } from "node:child_process";
import { BridgeError } from "./bridge-error.js";

/** `em` version this bridge was last verified against. */
export const MINIMUM_EM_VERSION = "1.7.0";

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Extracts the first `X.Y.Z` run of digits from a version string --
 *  tolerant of `em`'s output carrying extra text (e.g. a leading "em "
 *  or trailing build metadata). Returns undefined if none is found. */
export function parseSemver(raw: string): Semver | undefined {
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Standard three-way semver comparison: negative if `a` < `b`, zero if
 *  equal, positive if `a` > `b`. Ignores anything beyond major.minor.patch
 *  (no prerelease/build-metadata precedence -- not needed for a simple
 *  floor check). */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** Runs `em --version` and returns its raw stdout, trimmed, or undefined if
 *  `em` isn't on PATH or exits non-zero. Never throws itself -- fail-closed
 *  handling (what to do about a missing `em`) is the caller's job, per
 *  assertMinimumEmVersion below. */
export function getEmVersionRaw(): string | undefined {
  try {
    return execFileSync("em", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Fail-closed: throws a BridgeError (never a raw Error, so bridge.ts's and
 * mark-implemented.ts's top-level catch pretty-prints it like any other
 * refusal) when `em` is missing, its version output is unparseable, or it's
 * below `minVersion`. Returns silently when the installed `em` satisfies
 * the floor.
 *
 * `getVersionRaw` is injectable (defaults to the real getEmVersionRaw) so
 * the version-comparison branches below are unit-testable without needing
 * an actual `em` binary at a specific version on PATH -- this package's
 * other em-shelling code (em-runner.ts) has no comparable branch to test in
 * isolation, so there is no existing execFileSync-mocking convention to
 * follow here; this keeps the real shell-out path itself exercised too
 * (see check-em-version.test.ts) via the same hasEm()-gated pattern used
 * elsewhere in this suite.
 */
export function assertMinimumEmVersion(
  minVersion: string = MINIMUM_EM_VERSION,
  getVersionRaw: () => string | undefined = getEmVersionRaw
): void {
  const raw = getVersionRaw();
  if (raw === undefined) {
    throw new BridgeError(
      `\`em\` was not found on PATH (or \`em --version\` failed to run). em-sdd-bridge requires ` +
        `\`em\` >=${minVersion} -- install it before running the bridge.`
    );
  }

  const found = parseSemver(raw);
  if (!found) {
    throw new BridgeError(
      `Could not parse a semver from \`em --version\` output ("${raw}"). em-sdd-bridge requires ` +
        `\`em\` >=${minVersion} -- verify your \`em\` install.`
    );
  }

  const floor = parseSemver(minVersion);
  if (!floor) {
    // Defensive only -- MINIMUM_EM_VERSION and any caller-supplied
    // minVersion are expected to always be well-formed semver literals.
    throw new BridgeError(`Internal error: minVersion "${minVersion}" is not a valid semver.`);
  }

  if (compareSemver(found, floor) < 0) {
    throw new BridgeError(
      `\`em\` ${raw} is below the minimum supported version ${minVersion}. em-sdd-bridge requires ` +
        `\`em\` >=${minVersion} -- upgrade \`em\` before running the bridge.`
    );
  }
}
