import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bridgeConfigPath, readBridgeConfig } from "../lib/bridge-config.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "em-sdd-bridge-config-"));
  mkdirSync(path.join(repoRoot, ".specify"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeConfig(contents: string): void {
  writeFileSync(bridgeConfigPath(repoRoot), contents);
}

describe("readBridgeConfig", () => {
  it("defaults to typespec contracts and events-first OFF when the file is absent", () => {
    expect(readBridgeConfig(repoRoot)).toEqual({ contractSource: "typespec", eventsFirst: false });
  });

  it("reads valid values", () => {
    writeConfig(JSON.stringify({ contractSource: "none", eventsFirst: true }));
    expect(readBridgeConfig(repoRoot)).toEqual({ contractSource: "none", eventsFirst: true });
  });

  it("an empty object keeps every default", () => {
    writeConfig("{}");
    expect(readBridgeConfig(repoRoot)).toEqual({ contractSource: "typespec", eventsFirst: false });
  });

  it("malformed JSON is a fileFailure (fail-closed), never a silent fallback -- and never a throw", () => {
    writeConfig("{ not json");
    const config = readBridgeConfig(repoRoot);
    expect(config.fileFailure).toMatch(/is not valid JSON/);
    expect(config.contractSource).toBe("typespec");
    expect(config.eventsFirst).toBe(false);
  });

  it("an unknown contractSource is a per-key failure that names the accepted values", () => {
    writeConfig(JSON.stringify({ contractSource: "avro" }));
    const config = readBridgeConfig(repoRoot);
    expect(config.contractSourceFailure).toMatch(/unknown "contractSource" value "avro".*typespec, none/);
    expect(config.contractSource).toBe("typespec");
    expect(config.eventsFirstFailure).toBeUndefined();
  });

  it("a non-boolean eventsFirst is a per-key failure and leaves events-first OFF", () => {
    writeConfig(JSON.stringify({ eventsFirst: "yes" }));
    const config = readBridgeConfig(repoRoot);
    expect(config.eventsFirstFailure).toMatch(/invalid "eventsFirst" value "yes"/);
    expect(config.eventsFirst).toBe(false);
    expect(config.contractSourceFailure).toBeUndefined();
  });

  it("reports both per-key failures together when both keys are bad", () => {
    writeConfig(JSON.stringify({ contractSource: 42, eventsFirst: 1 }));
    const config = readBridgeConfig(repoRoot);
    expect(config.contractSourceFailure).toBeDefined();
    expect(config.eventsFirstFailure).toBeDefined();
    expect(config.fileFailure).toBeUndefined();
  });
});
