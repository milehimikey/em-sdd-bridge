# em-sdd-bridge

A deterministic `em`-slice → spec-kit bridge: writes `spec.md` directly from
a ratified [`em`](https://github.com/milehimikey/em) slice doc (without ever
running `/speckit.specify`) — or, with `--symlink`, skips rendering entirely
and links `spec.md` straight to the slice doc — plus status → PR-link
automation (`mark-implemented`). Ships as a standalone, versioned npm package with two
CLI entry points, `em-sdd-bridge` and `em-sdd-mark-implemented`.

## Install

Run directly via `npx` (no install step needed for one-off use). This package
ships two `bin` entries; only `em-sdd-bridge` matches the package name, so
`npx` resolves it directly, but the second entry (`em-sdd-mark-implemented`)
needs npx's `-p <package> <command>` form to select a non-matching bin
without npx trying to fetch a package literally named
`em-sdd-mark-implemented` (which doesn't exist):

```sh
npx em-sdd-bridge@<pinned-version> <slice-key> [--dry-run]
npx -p em-sdd-bridge@<pinned-version> em-sdd-mark-implemented <slice-key> <pr-url>
```

Pin an explicit version (`@<pinned-version>`) rather than floating on
`latest` — this bridge enforces a minimum `em` version (see below), and
consuming projects should upgrade deliberately, not implicitly on every run.

Or install as a dev dependency in your spec-kit project — once installed
locally, both bins resolve directly (no `-p` needed; that form is only for
resolving a non-matching bin out of a package npx hasn't already installed):

```sh
npm install --save-dev em-sdd-bridge
npx em-sdd-bridge <slice-key> [--dry-run]
npx em-sdd-mark-implemented <slice-key> <pr-url>
```

## Usage

```sh
# Allocate a spec-kit feature (git branch + spec dir) and render spec.md
# from one ratified em slice doc. Never calls /speckit.specify.
npx em-sdd-bridge <slice-key> [--dry-run]

# Flip a slice doc's Status -> implemented and fill Implemented in -> a PR URL.
# (shown here as installed locally; see Install above for the npx -p form
# needed when running this specific entry point as a one-off, uninstalled.)
npx em-sdd-mark-implemented <slice-key> <pr-url>
```

**Caveat (0.3.0): `em-sdd-mark-implemented` still edits the legacy body-label
bullets** (`- **Status:**` / `- **Implemented in:**`), not the canonical YAML
frontmatter this same release makes the sole source of truth for
`em-sdd-bridge` and `em` itself. Against a frontmatter-only doc (the shape
every doc should now be authored in) it fails loudly and refuses -- no
`- **Status:**` bullet to find. Against a doc that still carries both
dialects, it "succeeds" but only flips the now-inert body bullet: the real,
frontmatter-derived status is untouched, a silent no-op from `em`'s and the
bridge's perspective.

**Resolved (MIL-101): native, bridge becomes a thin wrapper.** `em` will ship
`em slice mark-implemented <key> <pr-url>` as a frontmatter writer -- same
promotion precedent as `--slice-ready` (MIL-87), and the write-side mirror of
retiring the bridge's own frontmatter *reading* in this same release (MIL-94).
`em-sdd-mark-implemented` will migrate to shell out to that command instead of
regex-editing body bullets. Until that migration lands (tracked as
[MIL-103](https://linear.app/milehimikey/issue/MIL-103/em-native-em-slice-mark-implemented-key-pr-url-frontmatter)
-> [MIL-104](https://linear.app/milehimikey/issue/MIL-104/em-sdd-bridge-migrate-em-sdd-mark-implemented-to-a-thin-wrapper-over)),
the caveat above still applies -- don't rely on this command against a
frontmatter-only doc.

### `--symlink`: redirection mode (no rendered spec.md at all)

```sh
npx em-sdd-bridge <slice-key> --symlink [--dry-run]
```

The default mode above *emits*: it renders the slice into spec-kit's spec.md
format. `--symlink` *redirects* instead: allocation runs exactly the same
(branch + `specs/NNN-slug/` dir, same gates -- minimum `em` version, slice
readiness, pattern validation, design-completeness/events-first), but the
template-copied `spec.md` is replaced with a **relative symlink to the
ratified slice doc itself**. No spec content is generated, because none is
needed: spec-kit's phase consumers are prompts, not parsers -- they read
whatever `FEATURE_SPEC` resolves to -- and the shell layer's
`[[ -f spec.md ]]` checks pass through the link. The slice doc *is* the
spec; nothing between the slice and the code is committed.

Since there is no rendered header to carry the `**Traceability**:` line, the
command prints it on success -- paste it into the PR description.

Caveats:

- **POSIX only.** Symlink creation on Windows requires elevated privileges;
  use emission there.
- Downstream spec-kit prompts written against spec-template section names
  (acceptance scenarios, FR-00N) read the slice doc's sections instead
  (`## Scenarios`, `## Invariants`); a one-paragraph preamble in your
  project's phase-prompt overrides covers the vocabulary. The mapping is the
  same one `docs/slice-to-spec-mapping.md` specifies -- applied as
  instructions instead of as a rendered file.

Both commands default to locating the repo root (nearest ancestor `.specify/` directory)
and the sole `*.em` model file found there; override with `--repo-root` /
`--model` if your project names its model file something else, keeps more
than one `.em` file at the root, or keeps its model in a component
subdirectory (e.g. `design/<component>/model.em`). `--model` is
**repo-root-relative** when given as a relative path (resolved against
`--repo-root`/the discovered repo root, not the invoking shell's current
directory) -- pass `--model design/widget/model.em`, not a path relative to
wherever you happen to run the command from. An absolute `--model` path is
used as-is.

`em-sdd-bridge` allocates the feature in a single, race-free step (see
`src/lib/allocate-feature.ts`): when the spec-kit git extension is installed
(`.specify/extensions/git/scripts/bash/create-new-feature-branch.sh`), it creates
and checks out the numbered `NNN-slug` branch first, then forces
`create-new-feature.sh` to allocate the `specs/NNN-slug/` dir under that SAME
number -- one invocation produces the branch, the spec dir, and `spec.md`, with
no separate hand-rolled branch-creation step and no numbering drift between the
two (a mismatch fails loudly instead of silently pairing the wrong branch/dir).
When the extension isn't installed, allocation falls back to the original
`create-new-feature.sh`-only behavior (no branch is created). `--dry-run`
prints the rendered `spec.md` instead of writing it (uses both scripts' own
`--dry-run`, so nothing -- no branch, no directories, no `.specify/feature.json` --
is created).

**Caveat:** the git extension only automates branch *creation* at allocation
time. It does not provide checkout-time branch-name resolution -- switching
to an existing slice branch by hand is still a plain `git checkout`, spec-kit
does not resolve or validate the branch name for you on checkout.

**Both git-extension script layouts are supported:** some spec-kit versions
ship the git extension's branch script as `create-new-feature-branch.sh`;
current spec-kit renamed it to `create-new-feature.sh` (same basename as the
core script, disambiguated only by directory). The CLI contract is IDENTICAL
between the two for everything `allocate-feature.ts` relies on (`--json`,
`--dry-run`, `--short-name`, `--number`, `--allow-existing-branch`,
`--timestamp` in; `{"BRANCH_NAME","FEATURE_NUM"}` + `DRY_RUN:true` out) --
only the filename (and an unrelated `branch_template`/`branch_prefix`
templating feature current spec-kit dropped) differ. `allocateFeature()`
therefore probes for `create-new-feature.sh` first (preferred -- what any
project on a current spec-kit actually ships) and falls back to
`create-new-feature-branch.sh` for projects still on the older-vintage name,
so the fast, race-free allocation path works against either layout instead
of silently degrading to the no-git-extension fallback.

`.specify/feature.json` is per-checkout state that `create-new-feature.sh`
(re)writes on every real (non-dry-run) allocation. Gitignore it in your
consuming project -- the bridge never stages or commits it, and committing
it causes merge conflicts across concurrent slice branches.

## Minimum `em` version

`em-sdd-bridge` shells out to `em --version` and fails closed if `em` is
missing or below the version this bridge was last verified against (see
`src/lib/check-em-version.ts` for the current floor). This check runs before
any other precondition, at the very top of both `em-sdd-bridge` and
`em-sdd-mark-implemented` -- an unsupported `em` invalidates everything
downstream (export shape, slice/pattern semantics), so failing here first
keeps later error messages honest about what actually went wrong. It fails
with a plain, actionable message; it never tries to auto-install or
auto-upgrade `em` for you.

## Design-completeness and events-first preconditions

Before allocating a feature, `em-sdd-bridge` runs `src/lib/preconditions.ts`,
fail-closed:

- **Design-completeness**: the slice doc(s) must resolve; the component dir
  (the directory holding the `.em` model) must have exactly one event model,
  with `.em` preferred -- a `.puml`-only component dir fails, naming the
  legacy file; `slices/` must exist and contain at least one `*.md`; and,
  when the repo's declared contract source is TypeSpec (the default -- see
  `.specify/em-sdd.json` below), `typespec/main.tsp` must exist and
  `npx tsp compile main.tsp --no-emit` must exit 0. An unavailable TypeSpec
  compiler is itself a failure, never a silent skip.
- **Events-first**: every event the slice(s) emit or consume must already
  exist as a real type declaration (`class`, `data class`, `record`,
  `interface`, `object`, or TS `type X =`) somewhere in the consumer's
  `.kt`/`.java`/`.ts`/`.tsx` source tree -- TypeSpec models, Avro schemas,
  event-model entries, and string-literal mentions never count. **The bridge
  never creates, offers to create, or scaffolds a missing event** -- a
  failure here always means "author the event as real code first."

Every failure from both checks is collected and thrown together in one
`BridgeError`, never reported piecemeal.

`--skip-design-gate` bypasses both checks entirely and prints a loud warning.
It exists ONLY so this package's own test suite can exercise bridge mechanics
(allocation, spec rendering) independent of whether a real events-first
source tree or a TypeSpec compiler is available in the environment running
the tests. **Never use it for a real slice implementation.**

### `.specify/em-sdd.json`: declaring the repo's contract source

The TypeSpec checks encode one convention (contracts generated from
`typespec/main.tsp` in the component dir). Repos that satisfy events-first
some other way -- e.g. hand-authored event classes in the source tree, which
the events-first check verifies independently -- declare that as
repo-committed policy:

```json
{ "contractSource": "none" }
```

at `.specify/em-sdd.json` (relative to `--repo-root`). Only the two TypeSpec
checks are skipped; every other check in both gates still runs. When the
file is absent, the default is `"typespec"` -- existing consumers keep the
full gate untouched. This is deliberately a committed file, not a CLI flag:
which convention a repo follows is repo policy decided in review, not a
per-invocation choice an autonomous agent could quietly vary. Malformed JSON
or an unknown value is a gate **failure**, never a silent fallback.

### Slice-doc metadata: sourced from `em export`, not parsed here

As of `em-sdd-bridge` 0.3.0 (requiring `em` >=1.7.0, the release carrying
both the joined export, MIL-91, and the native readiness gate, MIL-87),
this package no longer parses slice-doc frontmatter at all. `pattern`,
`status`, `version`, `implementedIn`, and lineage (`splitFrom`/`mergedFrom`/
`supersededBy`) come straight from `em export`'s `slice.pattern`/`slice.doc`
fields -- structured, canonical frontmatter, joined server-side by `em`
itself. This retires the bridge's former dual-dialect (body-label vs. YAML
frontmatter) parser and the interop failure class it existed to paper over
(a frontmatter-only doc reading as `Status "(missing)"`).

`em export`'s doc join only recognizes a `note` that is EXACTLY the slug
convention `slices/<key>.md`; a custom note path (or no note at all) reads
as "no doc bound," with no bridge-side fallback. `em-sdd-bridge`'s own
`--doc` override still works for *locating* which file to render/link, but
has no effect on `em export`'s or `em validate --slice-ready`'s idea of
which doc is bound to a slice.

`em-sdd-bridge` still parses the slice doc's markdown **body** directly --
Intent, Command/Event/Read-Model tables, Invariants, Scenarios, Alternate &
Error Flows, Non-Functional Requirements, Open Questions -- since none of
that is in `em export` by design (frontmatter only, never the body).

### Readiness: delegated to `em validate --slice-ready`

The bridge no longer implements its own "ready to implement" predicate.
Before allocating a feature, it shells out to `em validate <model>
--slice-ready <key>` for each slice key and gates purely on the exit code
(0 = ready). `em`'s own diagnostic text is relayed verbatim into the
refusal -- never parsed or pattern-matched -- since em owns that format and
can change it freely. One gate implementation (em's), not two.

### `infrastructure-context.md`: a configurable narrowing hint

The events-first check narrows its search for a required event's type
declaration by reading `.specify/memory/infrastructure-context.md` (relative
to `--repo-root`): if a line in that file mentions the event name alongside a
path-shaped token, that path is tried FIRST before falling back to a full
tree search. This default path is a spec-kit convention (a project's shared
"where things live" memory file), not something this bridge invented or
requires you to adopt as-is -- it's a hint, never authoritative on its own,
and a stale or wrong hint only costs a little search time, never produces a
false "missing" result (the full-tree search still runs regardless).

If your spec-kit project keeps this kind of narrowing information at a
different path or under a different filename, there is currently no flag to
override it; the fallback (a full-tree search under `--repo-root`) still
finds real declarations correctly without it -- the hint is a search-order
optimization only, not a requirement for the events-first check to work.

## Contract

Implements your project's slice-to-spec mapping contract (the doc that
defines each slice-doc-template section's mapping to a `spec.md` section --
in this bridge's originating project, `docs/slice-to-spec-mapping.md`; that
doc is a convention for the *consuming* spec-kit project to define, not a
file this package ships or requires under that exact name) and a strict
one-slice-per-branch granularity rule: as of the merged Automation/
Translation reaction shape (`em` >=1.7.1, MIL-120), a reaction, the command
it triggers, and the event that command emits all live in ONE slice, so
1 slice = 1 spec = 1 PR holds with no exception -- a multi-key invocation is
refused outright (see `src/lib/pattern-validate.ts`).

## Tests

```sh
npm test          # vitest, fixtures under fixtures/
npm run typecheck
```

`fixtures/model.em` + `fixtures/export.json` model a walking-skeleton "Ping"
subject (State Change + State View + a merged Automation slice -- reaction,
command, and event sharing one slice, per the `em` >=1.7.1 shape) so a real
`em export` + real `create-new-feature.sh --dry-run` integration test is
exercised end to end (skips gracefully if `em` isn't on PATH).
`fixtures/typespec/main.tsp` is a minimal, dependency-free TypeSpec model;
positive-path compile assertions are gated on a `hasTsp()` helper (mirroring
`hasEm()`) and skip gracefully when `@typespec/compiler`'s `tsp` binary isn't
installed.

`src/test/allocate-feature.test.ts` builds scratch git repos (temp dirs, not
the real checkout) with the installed spec-kit scripts copied in, to prove
the branch+spec-dir allocation itself: a real, non-dry-run `runBridge()`
invocation against a repo with the git extension present creates the branch,
checks it out, allocates a same-numbered spec dir, writes `spec.md`, and
leaves `.specify/feature.json` written but untracked; `--dry-run` leaves no
branch or directories; and a repo without the extension still allocates the
spec dir via the core-script-only fallback (no branch).

### Before publishing: smoke-test the packaged binary, not just `npm test`

Every test above calls `runBridge()`/`runMarkImplemented()` as an imported
function directly — none of them exercise `dist/` through an actual
installed `bin` symlink, which is exactly how every real `npx`/npm-installed
consumer invokes this package. A prior version of this package shipped a
`isMain` check that silently no-op'd (exit 0, zero output) specifically
under that invocation path, undetected by `npm test` passing green. Before
publishing a new version, confirm the packaged binary actually works:

```sh
npm run build
npm pack
mkdir /tmp/em-sdd-bridge-smoketest && cd /tmp/em-sdd-bridge-smoketest
npm init -y && npm install --no-save /path/to/em-sdd-bridge-<version>.tgz
# copy a minimal .specify/ + model.em + slice doc in, then:

# Default (emission) mode:
node_modules/.bin/em-sdd-bridge <slice-key> --dry-run --skip-design-gate
# must print the rendered spec.md, not exit silently.

# --symlink (redirection) mode -- exercise separately; it takes an entirely
# different code path (no rendering, a relative symlink instead):
node_modules/.bin/em-sdd-bridge <slice-key> --symlink --dry-run --skip-design-gate
# must print the would-be symlink target and the Traceability line, not exit silently.
```

`src/test/check-em-version.test.ts` covers the minimum-`em`-version check:
pure parsing/comparison-logic tests via dependency injection (no `em` binary
needed to exercise "missing", "unparseable", and "below floor" branches
deterministically), plus a `hasEm()`-gated integration test against the real
installed `em`. Because the version check now runs unconditionally at the
top of both entry points, `src/test/mark-implemented.cli.test.ts` -- which
exercises the `--file` codepath that otherwise never shells out to `em` --
is now also gated on `hasEm()`, so CI (which deliberately does not install
`em`) skips it instead of failing.
