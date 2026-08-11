import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifySlice, findSliceByKey, findSliceDocRelativePath, type ExportedModel } from "../lib/export-model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportModel: ExportedModel = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../fixtures/export.json"), "utf8")
);

describe("classifySlice", () => {
  it("classifies a command+event slice as state-change", () => {
    expect(classifySlice(findSliceByKey(exportModel, "record-ping")!)).toBe("state-change");
  });

  it("classifies a view-only slice as state-view", () => {
    expect(classifySlice(findSliceByKey(exportModel, "recent-pings")!)).toBe("state-view");
  });

  it("classifies a processor/translation-only slice as reaction", () => {
    expect(classifySlice(findSliceByKey(exportModel, "pings-to-notify")!)).toBe("reaction");
  });

  it("classifies the triggered command+event slice as state-change", () => {
    expect(classifySlice(findSliceByKey(exportModel, "send-notification")!)).toBe("state-change");
  });
});

describe("findSliceDocRelativePath", () => {
  it("uses the element note when present", () => {
    const slice = findSliceByKey(exportModel, "record-ping")!;
    expect(findSliceDocRelativePath(slice)).toBe("slices/record-ping.md");
  });

  it("falls back to the slug convention when no element carries a note", () => {
    const slice = { key: "no-note-slice", name: "No Note Slice", index: 0, line: 1, elements: [] };
    expect(findSliceDocRelativePath(slice)).toBe("slices/no-note-slice.md");
  });
});
