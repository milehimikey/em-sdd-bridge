# Releasing em-sdd-bridge

One release = one version everywhere: a `release: vX.Y.Z` commit on main, a git tag,
a GitHub release with narrative notes, the package on npm, and every shipped Linear
issue stamped with the release that delivered it. The `/release` command
(.claude/commands/release.md) drives the whole flow; this doc is the human-readable
record of it and of the one-time setup it depends on.

## The flow

1. **Preflight** — clean main, up to date, CI green.
2. **Scope + version** — everything since the last tag; semver bump (features →
   minor, fixes/docs → patch, breaking CLI/behavior changes → major).
3. **Bump** — `version` in package.json; run build + typecheck + tests.
4. **Notes** — title `X.Y.Z: <short narrative theme>`; body: theme paragraph, then
   Features / Fixes / Docs bullets with PR numbers and MIL-* ids.
5. **Ship** — commit `release: vX.Y.Z` to main, push, then
   `gh release create vX.Y.Z` with the notes. Creating the release creates the tag.
6. **Publish** — the tag push triggers `.github/workflows/release.yml`, which
   verifies the tag matches package.json and runs `npm publish`. The existing
   `prepublishOnly` script (build + typecheck + test) gates the publish itself.
   Verify with `npm view em-sdd-bridge version`.
7. **Linear** — stamp every shipped MIL-* issue with the release: the GitHub
   release URL attached as a link titled "Shipped in vX.Y.Z", and a check that
   the issue is actually Done. (Linear's first-class Releases feature is
   Business-plan only; on the free plan the issues themselves carry the record.)

npm publishing is deliberately CI-only: no local `npm publish`, no token on any
laptop. If the workflow fails, the release isn't done — fix and re-run before
updating Linear.

## One-time setup

**Configured** — on npmjs.com, package `em-sdd-bridge` → Settings → Publishing
access has a trusted publisher set up for GitHub Actions, repository
`milehimikey/em-sdd-bridge`, workflow `release.yml`. This lets the workflow
publish via OIDC with no NPM_TOKEN secret (and gives packages provenance
attestations for free). Mirrors the setup already done for `@milehimikey/em`
(see that repo's docs/release.md). Confirmed working as of v0.4.0 and v0.4.1.
If the package is ever renamed or the workflow file moves, this needs
re-configuring to match.

## Conventions

- Tag: `vX.Y.Z` (annotated via the GitHub release). Release title: `X.Y.Z: <theme>`
  — lowercase narrative theme naming the release's through-line, e.g.
  "0.4.0: the em 1.8-line reconciliation release".
- The release commit is `release: vX.Y.Z` and contains only the version bump.
- Every shipped Linear issue links back to the GitHub release that delivered it,
  so an issue's page answers "when did this actually ship?"
