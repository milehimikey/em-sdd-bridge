import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locateSliceDoc } from "../lib/locate-slice-doc.js";
import { BridgeError } from "../lib/bridge-error.js";
import type { ExportedModel } from "../lib/export-model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");
const modelPath = path.join(fixturesDir, "model.em");
const exportModel: ExportedModel = JSON.parse(readFileSync(path.join(fixturesDir, "export.json"), "utf8"));

describe("locateSliceDoc", () => {
  it("resolves the note-linked doc relative to the .em file", () => {
    const located = locateSliceDoc(exportModel, modelPath, "record-ping");
    expect(located.relativePath).toBe("slices/record-ping.md");
    expect(located.absolutePath).toBe(path.join(fixturesDir, "slices", "record-ping.md"));
  });

  it("throws for an unknown slice key", () => {
    expect(() => locateSliceDoc(exportModel, modelPath, "nope")).toThrow(BridgeError);
  });
});
