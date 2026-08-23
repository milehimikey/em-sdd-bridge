import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSliceByKey, findSliceDocRelativePath, type ExportedModel } from "../lib/export-model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportModel: ExportedModel = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../fixtures/export.json"), "utf8")
);

describe("ExportedSlice.pattern (em-derived, MIL-94)", () => {
  it("carries the model-derived pattern for a command+event slice", () => {
    expect(findSliceByKey(exportModel, "record-ping")!.pattern).toBe("state-change");
  });

  it("carries the model-derived pattern for a view-only slice", () => {
    expect(findSliceByKey(exportModel, "recent-pings")!.pattern).toBe("state-view");
  });

  it("carries the model-derived pattern for a view-only 'to-do list' slice feeding a reaction", () => {
    expect(findSliceByKey(exportModel, "pings-to-notify")!.pattern).toBe("state-view");
  });

  it("carries the model-derived pattern for the merged reaction+command+event slice, distinguishing automation from translation", () => {
    expect(findSliceByKey(exportModel, "send-notification")!.pattern).toBe("automation");
  });
});

describe("ExportedSlice.doc (slice-doc frontmatter join, MIL-94)", () => {
  it("reports found:true with the doc's frontmatter fields for a ratified slice", () => {
    const doc = findSliceByKey(exportModel, "record-ping")!.doc;
    expect(doc.found).toBe(true);
    expect(doc.reason).toBeNull();
    expect(doc.status).toBe("ready-to-implement");
    expect(doc.path).toBe("slices/record-ping.md");
  });
});

describe("findSliceDocRelativePath", () => {
  it("uses the element note when present", () => {
    const slice = findSliceByKey(exportModel, "record-ping")!;
    expect(findSliceDocRelativePath(slice)).toBe("slices/record-ping.md");
  });

  it("falls back to the slug convention when no element carries a note", () => {
    const slice = {
      key: "no-note-slice",
      name: "No Note Slice",
      index: 0,
      line: 1,
      pattern: "unclassified" as const,
      doc: {
        found: false,
        path: "slices/no-note-slice.md",
        reason: "no-doc-bound" as const,
        status: null,
        version: null,
        implementedIn: null,
        splitFrom: null,
        mergedFrom: [],
        supersededBy: [],
        driftSignal: null,
      },
      elements: [],
    };
    expect(findSliceDocRelativePath(slice)).toBe("slices/no-note-slice.md");
  });
});
