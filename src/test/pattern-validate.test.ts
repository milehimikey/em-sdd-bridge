import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSliceKeys } from "../lib/pattern-validate.js";
import { BridgeError } from "../lib/bridge-error.js";
import type { ExportedModel } from "../lib/export-model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportModel: ExportedModel = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../fixtures/export.json"), "utf8")
);

describe("validateSliceKeys", () => {
  it("accepts a single slice key", () => {
    const result = validateSliceKeys(exportModel, ["record-ping"]);
    expect(result.primary.key).toBe("record-ping");
  });

  it("accepts a single merged Automation slice key (reaction + command + event share one slice)", () => {
    const result = validateSliceKeys(exportModel, ["send-notification"]);
    expect(result.primary.key).toBe("send-notification");
    expect(result.primary.pattern).toBe("automation");
  });

  it("refuses two slice keys, pointing at the merged shape and a single slice key", () => {
    expect(() => validateSliceKeys(exportModel, ["record-ping", "recent-pings"])).toThrow(
      /exactly one slice key/
    );
    expect(() => validateSliceKeys(exportModel, ["record-ping", "recent-pings"])).toThrow(
      /merged Automation\/Translation reaction shape/
    );
  });

  // Even a key pair that WOULD have been a valid pattern-mandated bundle
  // under the old two-slice split is refused now -- there is no longer any
  // shape of 2-key invocation the bridge accepts.
  it("refuses two slice keys even when they'd have formed the old reactor/state-change pair", () => {
    expect(() => validateSliceKeys(exportModel, ["pings-to-notify", "send-notification"])).toThrow(
      /exactly one slice key/
    );
  });

  it("refuses more than two slice keys with the same merged-shape message", () => {
    expect(() =>
      validateSliceKeys(exportModel, ["record-ping", "recent-pings", "pings-to-notify"])
    ).toThrow(/exactly one slice key/);
  });

  it("refuses an unknown slice key", () => {
    expect(() => validateSliceKeys(exportModel, ["does-not-exist"])).toThrow(/not found/);
  });

  it("refuses zero slice keys", () => {
    expect(() => validateSliceKeys(exportModel, [])).toThrow(/At least one/);
  });

  describe("display-name key resolution (#17)", () => {
    // Clone fixture slices under display-style export keys.
    function modelWithKeys(keys: string[]): ExportedModel {
      const base = exportModel.model.slices[0];
      return {
        ...exportModel,
        model: { ...exportModel.model, slices: keys.map((key) => ({ ...base, key })) },
      };
    }
    const model = modelWithKeys([
      "abc-0039-finalize-invoice",
      "abc-0040-void-invoice",
      "abc-0041-send-invoice",
      "xyz-0001-other",
      "abc-0039x-not-a-match",
    ]);

    it("prefers an exact export-key match and logs nothing", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = validateSliceKeys(model, ["abc-0040-void-invoice"]);
      expect(result.primary.key).toBe("abc-0040-void-invoice");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("resolves a unique case-insensitive display key and logs the resolution to stderr", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = validateSliceKeys(model, ["ABC-0039"]);
      expect(result.primary.key).toBe("abc-0039-finalize-invoice");
      expect(spy).toHaveBeenCalledWith(
        'bridge: resolved slice key "ABC-0039" -> "abc-0039-finalize-invoice"'
      );
      spy.mockRestore();
    });

    it("refuses an ambiguous prefix, listing the candidates", () => {
      const ambiguous = modelWithKeys(["abc-0039-finalize-invoice", "abc-0039-void-invoice"]);
      const run = () => validateSliceKeys(ambiguous, ["ABC-0039"]);
      expect(run).toThrow(BridgeError);
      expect(run).toThrow(/ambiguous/);
      expect(run).toThrow(/abc-0039-finalize-invoice, abc-0039-void-invoice/);
    });

    it("requires a hyphen boundary: ABC-003 does not prefix-match abc-0039-...", () => {
      expect(() => validateSliceKeys(model, ["ABC-003"])).toThrow(/not found/);
    });

    it("on no match, suggests nearby keys (substring), capped at 5", () => {
      expect(() => validateSliceKeys(model, ["invoice"])).toThrow(
        /Did you mean: abc-0039-finalize-invoice, abc-0040-void-invoice, abc-0041-send-invoice\?/
      );
      const many = modelWithKeys(Array.from({ length: 8 }, (_, i) => `foo-000${i}-thing`));
      try {
        validateSliceKeys(many, ["thing"]);
        expect.unreachable();
      } catch (err) {
        expect((err as Error).message.match(/foo-/g)).toHaveLength(5);
      }
    });

    it("on no match with nothing nearby, lists available keys instead", () => {
      expect(() => validateSliceKeys(model, ["zzz"])).toThrow(/Available keys: abc-0039-finalize-invoice/);
    });
  });
});
