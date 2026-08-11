import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveModelPath } from "../lib/em-runner.js";
import { BridgeError } from "../lib/bridge-error.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function mkTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "em-runner-"));
  tmpDirs.push(dir);
  return dir;
}

describe("resolveModelPath", () => {
  it("uses the sole .em file at repo root when no override is given", () => {
    const repoRoot = mkTmp();
    writeFileSync(path.join(repoRoot, "model.em"), 'model "X"\n');
    expect(resolveModelPath(repoRoot)).toBe(path.join(repoRoot, "model.em"));
  });

  it("throws BridgeError when repo root has zero or multiple .em files and no override", () => {
    const repoRoot = mkTmp();
    expect(() => resolveModelPath(repoRoot)).toThrow(BridgeError);
    writeFileSync(path.join(repoRoot, "a.em"), 'model "A"\n');
    writeFileSync(path.join(repoRoot, "b.em"), 'model "B"\n');
    expect(() => resolveModelPath(repoRoot)).toThrow(BridgeError);
  });

  it("uses an absolute --model override as-is", () => {
    const repoRoot = mkTmp();
    const elsewhere = mkTmp();
    const absoluteModel = path.join(elsewhere, "custom.em");
    writeFileSync(absoluteModel, 'model "Custom"\n');
    expect(resolveModelPath(repoRoot, absoluteModel)).toBe(absoluteModel);
  });

  // A relative --model override must resolve against repoRoot, not
  // process.cwd() -- otherwise the resolved path silently depends on where
  // the bridge happens to be invoked from.
  it("resolves a relative --model override against repoRoot, not process.cwd()", () => {
    const repoRoot = mkTmp();
    writeFileSync(path.join(repoRoot, "nested.em"), 'model "Nested"\n');
    const originalCwd = process.cwd();
    const unrelatedCwd = mkTmp(); // deliberately has no nested.em
    process.chdir(unrelatedCwd);
    try {
      expect(resolveModelPath(repoRoot, "nested.em")).toBe(path.join(repoRoot, "nested.em"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("resolves a relative --model override under a subdirectory of repoRoot", () => {
    const repoRoot = mkTmp();
    const componentDir = path.join(repoRoot, "design", "widget");
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(path.join(componentDir, "model.em"), 'model "Widget"\n');
    expect(resolveModelPath(repoRoot, "design/widget/model.em")).toBe(
      path.join(repoRoot, "design", "widget", "model.em")
    );
  });
});
