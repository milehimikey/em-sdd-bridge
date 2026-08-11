import { describe, expect, it } from "vitest";
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
    expect(result.secondary).toBeUndefined();
  });

  it("accepts a pattern-mandated reaction -> state-change pair, reactor first", () => {
    const result = validateSliceKeys(exportModel, ["pings-to-notify", "send-notification"]);
    expect(result.primary.key).toBe("pings-to-notify");
    expect(result.secondary?.key).toBe("send-notification");
  });

  it("accepts the same pair given in the other order", () => {
    const result = validateSliceKeys(exportModel, ["send-notification", "pings-to-notify"]);
    expect(result.primary.key).toBe("pings-to-notify");
    expect(result.secondary?.key).toBe("send-notification");
  });

  it("refuses two slices that are not a reaction/state-change pair", () => {
    expect(() => validateSliceKeys(exportModel, ["record-ping", "recent-pings"])).toThrow(
      /not a pattern-mandated Automation\/Translation pair/
    );
  });

  it("refuses a reaction paired with a non-adjacent state-change slice", () => {
    expect(() => validateSliceKeys(exportModel, ["pings-to-notify", "record-ping"])).toThrow(BridgeError);
  });

  it("refuses more than two slice keys", () => {
    expect(() =>
      validateSliceKeys(exportModel, ["record-ping", "recent-pings", "pings-to-notify"])
    ).toThrow(/out of scope/);
  });

  it("refuses an unknown slice key", () => {
    expect(() => validateSliceKeys(exportModel, ["does-not-exist"])).toThrow(/not found/);
  });

  it("refuses zero slice keys", () => {
    expect(() => validateSliceKeys(exportModel, [])).toThrow(/At least one/);
  });
});
