/**
 * Returns a copy of process.env with every `GIT_*` variable removed.
 *
 * Why this exists (observed 2026-08-10): when a git hook runs (e.g.
 * pre-commit), git exports GIT_DIR, GIT_INDEX_FILE, GIT_AUTHOR_*, etc. to the
 * hook process, and every child process inherits them. Any git command
 * spawned from here -- directly (test scratch repos) or transitively (the
 * spec-kit allocation scripts this bridge wraps call git) -- then operates on
 * the HOOK'S repository and index instead of its own cwd, regardless of the
 * cwd passed to the spawn. During a downstream port, a vitest run under a
 * pre-commit hook rewrote the host repo's index and local git identity this
 * way. Scrubbing GIT_* restores git's normal cwd-based repo discovery for the
 * child.
 */
export function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  return env;
}
