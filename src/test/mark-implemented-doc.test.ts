import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyImplementedStatus } from "../lib/mark-implemented-doc.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.resolve(__dirname, "../../fixtures/slices/record-ping.md"), "utf8");

describe("applyImplementedStatus", () => {
  it("flips Status and fills Implemented in on a ready (not-yet-implemented) doc", () => {
    const result = applyImplementedStatus(fixture, "https://github.com/org/repo/pull/42");
    expect(result.changed).toBe(true);
    expect(result.content).toContain("- **Status:** implemented");
    expect(result.content).toContain("- **Implemented in:** https://github.com/org/repo/pull/42");
    // Nothing else in the doc should move.
    expect(result.content).toContain("## Intent");
    expect(result.content).toContain("**INV-1:** Reject Record Ping");
  });

  it("is idempotent: re-applying the same URL is a no-op", () => {
    const first = applyImplementedStatus(fixture, "https://github.com/org/repo/pull/42");
    const second = applyImplementedStatus(first.content, "https://github.com/org/repo/pull/42");
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it("refuses to overwrite an existing different URL", () => {
    const first = applyImplementedStatus(fixture, "https://github.com/org/repo/pull/42");
    expect(() => applyImplementedStatus(first.content, "https://github.com/org/repo/pull/999")).toThrow(
      /already marked implemented with a different URL/
    );
  });

  it("refuses when the Status field is missing", () => {
    expect(() => applyImplementedStatus("# Slice: X\n\nno status field", "https://x/1")).toThrow(BridgeError);
  });
});
