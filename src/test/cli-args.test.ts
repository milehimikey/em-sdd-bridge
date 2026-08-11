import { describe, expect, it } from "vitest";
import { parseArgs } from "../lib/cli-args.js";
import { BridgeError } from "../lib/bridge-error.js";

describe("parseArgs", () => {
  it("splits positional args, value flags, and boolean flags", () => {
    const result = parseArgs(
      ["record-ping", "--repo-root", "/tmp/repo", "--dry-run", "extra-positional"],
      ["--repo-root", "--model"],
      ["--dry-run"]
    );
    expect(result.positional).toEqual(["record-ping", "extra-positional"]);
    expect(result.flags).toEqual({ "repo-root": "/tmp/repo" });
    expect(result.booleans.has("dry-run")).toBe(true);
  });

  // A value flag missing its value must fail as a friendly BridgeError
  // (pretty-printed by bridge.ts/mark-implemented.ts), not a raw Error
  // (uncaught stack trace).
  it("throws a BridgeError, not a raw Error, when a value flag is missing its value", () => {
    expect(() => parseArgs(["record-ping", "--model"], ["--model"], [])).toThrow(BridgeError);
    expect(() => parseArgs(["record-ping", "--model"], ["--model"], [])).toThrow(/--model requires a value/);
  });

  it("throws a BridgeError when a value flag is the last argument", () => {
    expect(() => parseArgs(["--repo-root"], ["--repo-root"], [])).toThrow(BridgeError);
  });
});
