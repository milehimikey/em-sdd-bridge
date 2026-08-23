# fixtures/speckit-scripts

A pinned copy of the spec-kit scripts this bridge wraps, refreshed during a
downstream port to match that project's own pinned spec-kit version
(`.speckit-version` = `0.14.4`) wherever a like-for-like file exists:

- `.specify/scripts/bash/common.sh`, `.specify/scripts/bash/create-new-feature.sh`
  (core; always installed) -- copied verbatim from this repo's
  `.specify/scripts/bash/`. Byte-identical to em-sdd-preset's pinned 0.14.2
  fixture copy (diffed during that port; no drift since 0.14.2).
- `.specify/templates/spec-template.md` (core; `create-new-feature.sh` copies
  this into new spec dirs) -- copied verbatim from this repo's
  `.specify/templates/`. Also byte-identical to the 0.14.2 fixture.
- `.specify/extensions/git/scripts/bash/git-common.sh` -- copied verbatim from
  this repo's `.specify/extensions/git/scripts/bash/`. NOT byte-identical to
  the 0.14.2 fixture: `check_feature_branch` dropped path-style namespace
  prefix support (`<prefix>/001-feature-name`) between 0.14.2 and 0.14.4. This
  function isn't called by anything in `tooling/bridge/`, so the behavioral
  diff doesn't change the bridge's own contract.
- `.specify/extensions/git/scripts/bash/create-new-feature.sh` -- **added**,
  copied verbatim from this repo's real
  `.specify/extensions/git/scripts/bash/create-new-feature.sh`. This is this
  repo's (and current spec-kit's) actual 0.14.4 filename for the git
  extension's branch-creation script -- confirmed by reading it in full: its
  CLI contract (`--json`, `--dry-run`, `--short-name`, `--number`,
  `--allow-existing-branch`, `--timestamp`) and JSON output
  (`{"BRANCH_NAME","FEATURE_NUM"}`, `+DRY_RUN:true` when dry-run) are
  IDENTICAL to the 0.14.2-era script below for everything
  `allocate-feature.ts` relies on; only the filename and the
  `branch_template`/`branch_prefix` git-config.yml templating feature
  (removed in 0.14.4) differ.
- `.specify/extensions/git/scripts/bash/create-new-feature-branch.sh` --
  **kept, at its original em-sdd-preset 0.14.2 content**, specifically so
  `allocate-feature.test.ts`'s legacy-fallback tests can exercise
  `allocate-feature.ts`'s dual-layout probe (added during that same port:
  it checks for `create-new-feature.sh` first, preferring the current name,
  falling back to this legacy name) against a real project still on that
  vintage.
  This is the only file this fixture keeps both a current- and legacy-named
  copy of, and deliberately so -- **do not delete this file**, it is load-
  bearing fixture content, not stale leftovers.

Both git-extension branch scripts coexist in this fixture on purpose:
`bridge.integration.test.ts` (which points `--repo-root` directly at this
fixture dir) exercises the "prefer the current name" path since
`create-new-feature.sh` exists; `allocate-feature.test.ts` builds disposable
scratch repos copying in only ONE of the two filenames at a time (see its
`buildScratchRepo()` helper) to test detection of the current name and the
legacy-fallback name independently.

Stands in for a real `specify init`-generated `.specify/` checkout so the
bridge's test suite is self-contained and doesn't depend on being run from
inside an actual spec-kit project. Update this fixture if the preset's pinned
spec-kit version changes (see the preset README) -- and re-run the diff
against this repo's actual `.specify/` before assuming any file is still
current.
