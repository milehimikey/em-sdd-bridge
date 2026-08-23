import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSliceKeys } from "../lib/pattern-validate.js";
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
});
