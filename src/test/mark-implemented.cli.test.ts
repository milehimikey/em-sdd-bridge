import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMarkImplemented } from "../mark-implemented.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../../fixtures/slices/record-ping.md");

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

function copyFixtureToTmp(): string {
  tmpDir = mkdtempSync(path.join(tmpdir(), "bridge-mark-implemented-"));
  const dest = path.join(tmpDir, "record-ping.md");
  writeFileSync(dest, readFileSync(fixturePath, "utf8"));
  return dest;
}

// --file bypasses both the `em export` lookup AND the minimum-em-version
// check that guards it (see mark-implemented.ts) -- genuinely `em`-independent,
// so this suite needs no hasEm() gate.
describe("runMarkImplemented (--file, round trip)", () => {
  it("flips a fresh slice doc to implemented, then no-ops on re-run with the same URL", () => {
    const docPath = copyFixtureToTmp();
    const prUrl = "https://github.com/example-org/example-repo/pull/123";

    const first = runMarkImplemented(["record-ping", prUrl, "--file", docPath]);
    expect(first.changed).toBe(true);
    let content = readFileSync(docPath, "utf8");
    expect(content).toContain("- **Status:** implemented");
    expect(content).toContain(`- **Implemented in:** ${prUrl}`);

    const second = runMarkImplemented(["record-ping", prUrl, "--file", docPath]);
    expect(second.changed).toBe(false);
    content = readFileSync(docPath, "utf8");
    expect(content).toContain(`- **Implemented in:** ${prUrl}`);
  });

  it("refuses a second run with a different URL", () => {
    const docPath = copyFixtureToTmp();
    runMarkImplemented(["record-ping", "https://github.com/org/repo/pull/1", "--file", docPath]);
    expect(() =>
      runMarkImplemented(["record-ping", "https://github.com/org/repo/pull/2", "--file", docPath])
    ).toThrow(/already marked implemented with a different URL/);
  });

  it("refuses when the slice doc file doesn't exist", () => {
    expect(() =>
      runMarkImplemented(["nope", "https://github.com/org/repo/pull/1", "--file", "/nonexistent/path.md"])
    ).toThrow();
  });
});
