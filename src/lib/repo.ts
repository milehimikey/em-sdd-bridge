import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Walk up from `startDir` looking for a `.specify` directory -- mirrors
 * `.specify/scripts/bash/common.sh`'s `find_specify_root`, so the bridge locates
 * the same repo root spec-kit's own scripts would.
 */
export function findRepoRoot(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(path.join(dir, ".specify"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
