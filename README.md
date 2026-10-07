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

# Full usage / installed version (work without em, outside a repo).
npx em-sdd-bridge --help
npx em-sdd-bridge --version
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

Slice keys are the `em export` keys (e.g. `abc-0039-finalize-invoice`). A
display form such as `ABC-0039` also works when it is a case-insensitive
prefix (followed by `-`) of exactly one key; the resolved key is logged to
stderr. Ambiguous or unknown keys fail with the candidate or nearest keys
listed (#17).

One slice, one feature: if `specs/NNN-<slice-key>/` already exists, the
bridge refuses rather than allocating a duplicate feature and branch.
Continue on the existing feature's branch, or delete its spec dir (and
branch) to bridge the slice again (#20). `--slices-dir` is deprecated: it
never had an effect, now prints a warning, and will be removed (#21).

### `--skip-readiness-gate`: building ahead of ratification

By default the bridge refuses any slice that `em validate --slice-ready`
does not report as ready-to-implement. Pass `--skip-readiness-gate` to build
ahead of ratification (e.g. a `draft` slice with recorded build
assumptions). This is a supported path, not a test hook: the bridge prints a
loud warning that the slice is not ratified and the gate was bypassed by
explicit choice. It bypasses only the readiness gate; the
design-completeness and (when enabled) events-first checks still run unless
`--skip-design-gate` is also given (#15).

**Native, as of 0.4.0: `em-sdd-mark-implemented` is a thin wrapper.** It no
longer edits a slice doc itself at all. It resolves the `.em` model to use
(the same `resolveModelPath` convention `em export`/`em validate
--slice-ready` already use -- an explicit `--model` override, or the sole
`*.em` file at `--repo-root`) and shells out to `em slice mark-implemented
<model> <slice-key> <pr-url>` (MIL-103, requires `em` >=1.8.0), the native
frontmatter writer -- same promotion precedent as `--slice-ready` (MIL-87),
and the write-side mirror of the bridge's own frontmatter *reading* being
retired in 0.3.0 (MIL-94). One writer implementation (em's), not two.

`em`'s own stdout/stderr and exit code are relayed verbatim -- never parsed
or pattern-matched, since `em` owns that format and can change it freely.
That means it's `em`'s behavior that governs here: idempotent when re-run
with the same PR URL; refuses (non-zero exit) if the slice doc is already
`implemented` with a *different* URL; never touches `version:` or the doc
body.

### `--symlink`: redirection mode (no rendered spec.md at all)

```sh
npx em-sdd-bridge <slice-key> --symlink [--dry-run]
```

The default mode above *emits*: it renders the slice into spec-kit's spec.md
format. `--symlink` *redirects* instead: allocation runs exactly the same
(branch + `specs/NNN-slug/` dir, same gates -- minimum `em` version, slice
readiness, pattern validation, design-completeness/events-first when enabled), but the
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

## Verified spec-kit vintage

`allocate-feature.ts` shells out to your project's installed spec-kit
scripts with a fixed set of flags (`--json`, `--dry-run`, `--short-name`,
`--number`, ...) -- it never negotiates or probes for script capabilities at
allocation time. That contract is verified against the spec-kit vintage
pinned in this package's `fixtures/speckit-scripts/` (see that directory's
own README for the exact version last verified).

**A fresh `specify init` is not guaranteed to produce a compatible
scaffold.** Confirmed real drift (MIL-150, 2026-08-23): a scaffold produced
by upstream `specify init` shipped a core `create-new-feature.sh` that did
not understand `--short-name`/`--number` at all -- and, worse, silently
folded the unrecognized flags into the feature description instead of
erroring, which would otherwise surface many steps downstream as a
confusing failure (a JSON parse error, or a garbled feature/branch name)
with no hint that the real cause is scaffold incompatibility.

To catch this before it can produce a bad allocation, `em-sdd-bridge` runs
`src/lib/check-speckit-scaffold.ts` immediately after locating the repo
root, before any other work: it reads the installed core script (and the
git extension's branch script, if installed) and fails closed, naming
exactly which required flag(s) are missing from which file, if either
script's own source doesn't declare a case-pattern arm for them. If this
check fails, replace the named script(s) -- and their siblings
(`common.sh` alongside the core script; `git-common.sh` alongside the git
extension's) -- with the pinned, verified-compatible copies from this
package's `fixtures/speckit-scripts/.specify/` tree.

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

## Constitution advisory

`/speckit.plan` and `/speckit.tasks` read `.specify/memory/constitution.md`
as the project's governing rules. `specify init` scaffolds that file from a
stock template full of bracketed placeholder tokens (`[PROJECT_NAME]`,
`[PRINCIPLE_1_NAME]`, ...), and nothing stops a repo from carrying that
template, unfilled, indefinitely -- it looks filled from a distance and
governs nothing.

`em-sdd-bridge` runs `src/lib/check-constitution.ts` right after locating
the repo root: if `.specify/memory/constitution.md` exists and still
contains one or more of the stock template's placeholder tokens, it prints
one warning line to stderr naming every token found, then continues --
**advisory only, it never gates the run**. A team may legitimately choose to
run without a filled-in constitution; the point is only that they never do
so unknowingly. Fill in the constitution (as of `em` >=1.11, the
`event-modeling-implement` skill has a constitution-elicitation step) or
ratify a real one to clear the warning.

Detection is mechanical -- a placeholder-token regex over the file's own
text, the same fail-closed-tooling style as
`src/lib/check-speckit-scaffold.ts`'s static source inspection -- no LLM,
no new gate.

**Known gap:** this check is scoped to an *existing* `constitution.md` only
(per the ticket this shipped under, MIL-203). A repo with **no**
`.specify/memory/constitution.md` at all gets no signal from this check --
running without a constitution and running with an unfilled one currently
look the same (silent) to this bridge. Closing that gap -- e.g. warning on a
missing file too -- is left for the package owner to decide, since a
missing file is a more deliberate-looking state than a leftover template and
may deserve different (or no) messaging.

## Design-completeness and events-first preconditions

Before allocating a feature, `em-sdd-bridge` runs `src/lib/preconditions.ts`,
fail-closed:

- **Design-completeness**: the slice doc(s) must resolve; the component dir
  (the directory holding the `.em` model) must have exactly one event model,
  with `.em` preferred -- a `.puml`-only component dir fails, naming the
  legacy file; `slices/` must exist and contain at least one `*.md`; and,
  when the repo's declared contract source is TypeSpec (the default -- see
  `.specify/em-sdd.json` below), `typespec/main.tsp` must exist and
  `tsp compile main.tsp --no-emit` must exit 0 in that directory. The
  compiler is resolved in this order (#25): the `tspCommand` configured in
  `.specify/em-sdd.json`; the nearest `node_modules/.bin/tsp`, walking up
  from the typespec dir to the repo root; then `npx --no-install tsp`
  (`--no-install` on purpose: an unrelated `tsp` package exists on the
  public registry). A failure names its cause and the fix: **compiler not
  runnable** (missing executable, broken interpreter path from a stale npx
  cache, exit 126/127), **library not resolvable** (the compiler ran but an
  import such as `@typespec/http` did not resolve from the typespec dir, so
  the TypeSpec may well be valid), or **compile errors** (the diagnostics,
  verbatim). An unavailable TypeSpec compiler is itself a failure, never a
  silent skip.
- **Events-first** (opt-in, off by default as of 0.6.0 -- see
  `eventsFirst` below): every event the slice(s) emit or consume must already
  exist as a real type declaration (`class`, `data class`, `record`,
  `interface`, `object`, or TS `type X =`) somewhere in the consumer's
  `.kt`/`.java`/`.ts`/`.tsx` source tree -- TypeSpec models, Avro schemas,
  event-model entries, and string-literal mentions never count. **The bridge
  never creates, offers to create, or scaffolds a missing event** -- a
  failure here always means "author the event as real code first."

Every failure from the enabled checks is collected and thrown together in one
`BridgeError`, never reported piecemeal.

`--skip-design-gate` bypasses design-completeness and (when enabled) events-first entirely and prints a loud warning.
It exists ONLY so this package's own test suite can exercise bridge mechanics
(allocation, spec rendering) independent of whether a real events-first
source tree or a TypeSpec compiler is available in the environment running
the tests. **Never use it for a real slice implementation.**

### `.specify/em-sdd.json`: contract source, events-first policy, heading aliases

```json
{
  "contractSource": "typespec",
  "eventsFirst": false,
  "sectionAliases": { "readModel": ["Projection"], "sourceEvents": ["Inputs"] },
  "tspCommand": ["mise", "exec", "--", "tsp"]
}
```

at `.specify/em-sdd.json` (relative to `--repo-root`):

- `contractSource` (`"typespec"` default | `"none"`): the TypeSpec checks
  encode one convention (contracts generated from `typespec/main.tsp` in the
  component dir). `"none"` skips only those two TypeSpec checks; every other
  design-completeness check still runs.
- `eventsFirst` (boolean, **default `false`**): when `true`, every event a
  slice emits or consumes must already exist as a real type declaration
  before the bridge generates a spec (#13).
- `sectionAliases` (object, default none): extra H2 headings the slice-doc
  parser accepts for each field, **appended** to the built-in aliases listed
  under "Slice-doc body: heading aliases" below. Keys are the field names
  (`intent`, `triggerActor`, `command`, `events`, `readModel`,
  `sourceEvents`, `invariants`, `scenarios`, `alternateErrorFlows`,
  `nonFunctional`, `openQuestions`); values are non-empty lists of
  headings. An unknown key or a malformed value is a gate failure (#24).
- `tspCommand` (array of strings, default none): the TypeSpec compiler the
  design gate runs, as an argv prefix -- `["mise", "exec", "--", "tsp"]`,
  `["/path/to/tsp"]` -- for repos whose compiler is provided by a toolchain
  manager or a global install rather than a local `node_modules`. Absent,
  the gate resolves the compiler itself (see the design-completeness bullet
  above). Anything but a non-empty array of non-empty strings is a gate
  failure, and no fallback compiler is tried in its place (#25).

**Events-first trade-off.** It gives determinism to teams that practice
contract-first design or reverse-document already-built code: the types are
proven to exist before a spec is written. It also inverts the usual
spec -> plan -> tasks -> implement order, because the event type is normally
written during implementation. Leave it off unless your team declares event
types before specifying them. It is independent of `contractSource`. When the
file is absent, the default is `"typespec"` -- existing consumers keep the
full gate untouched. This is deliberately a committed file, not a CLI flag:
which convention a repo follows is repo policy decided in review, not a
per-invocation choice an autonomous agent could quietly vary. Malformed JSON,
an unknown `contractSource`, a non-boolean `eventsFirst`, a malformed `sectionAliases`, or a malformed `tspCommand` is a gate **failure**, never a silent fallback.

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

The doc's H1 may be either `# Slice: <Name>` (what `em slice new` writes) or
the pattern-prefixed `# State Change Slice: <Name>` / `# State View Slice:
<Name>` / `# Automation Slice: <Name>` / `# Translation Slice: <Name>` form
that skill-authored docs use (#23); the prefix is dropped from the name. A
doc with no such H1 at all takes its name from `em export`'s `slice.name`.

### Slice-doc body: heading aliases and required content

Sections are found by heading, matched case- and whitespace-insensitively
against a per-field alias list (#24). The first alias is the em template's
own heading; the rest are headings seen in docs written to other templates.
HTML comments (`<!-- none -->`) never count as content.

| Field | Headings accepted |
|---|---|
| intent | Intent, Purpose, Goal |
| triggerActor | Trigger & Actor, Trigger / Actor, Trigger, Actor, Read Trigger, Query |
| command | Command / Input, Command, Input |
| events | Event(s) Emitted, Events Emitted, Event Emitted, Events, Event |
| readModel | Read Model / View, Read Model, View, Projection |
| sourceEvents | Source Events, Data Source, Built From Events, Consumed Events |
| invariants | Invariants / Business Rules, Invariants, Business Rules, Rules |
| scenarios | Scenarios (Given / When / Then), Scenarios, Acceptance Scenarios, Given / When / Then |
| alternateErrorFlows | Alternate & Error Flows, Alternate / Error Flows, Alternate Flows, Error Flows |
| nonFunctional | Non-Functional Requirements, Non-Functional, NFRs, NFR |
| openQuestions | Open Questions, Questions |

Extend any list with `sectionAliases` in `.specify/em-sdd.json` (above).
The read model's name comes from a `**View:**`, `**Read Model:**` or
`**Name:**` bullet, else the first backticked name in the section; its
"built from" events come from the `built from events:` clause on that line,
else from a `sourceEvents` section (one event per bullet or table row).
Invariant ids follow em's own grammar (`INV_TOKEN_RE` in em's
`src/cli/coverage.ts`): `INV-` then alphanumeric segments, so `INV-1`,
`INV-EO-1`, `INV-ACCT-19` and the letter-suffixed sub-invariant `INV-CHK-3a`
all parse, in both the invariant bullet and a `Rejected (INV-...)` label.
Scenarios may be authored either as one line, `- **Happy path** — Given a,
When b, Then c.`, or in em's current nested shape with `- **Given:**` /
`- **When:**` / `- **Then:**` sub-bullets under the label (#30); the nested
form is parsed into clauses and rendered as `**Given** a, **When** b,
**Then** c`.

**Required content, fail-closed.** A doc whose required fields parse empty
refuses the run rather than handing spec-kit a near-empty spec. The failure
names each empty field, the headings tried for it, what counts as content,
and the headings the doc actually has. Required per pattern: Intent and at
least one scenario for every pattern; the command and event for
`state-change`; the read model for `state-view`; the event for
`automation`; nothing further for `translation`. Invariants, alternate
flows, NFRs and open questions are always optional. `--symlink` mode is
exempt (nothing is rendered from the parse); `--skip-design-gate` does
**not** bypass this check, since it needs nothing from the environment.

### Readiness: delegated to `em validate --slice-ready`

The bridge no longer implements its own "ready to implement" predicate.
Before allocating a feature, it shells out to `em validate <model>
--slice-ready <key>` for each slice key and gates purely on the exit code
(0 = ready). `em`'s own diagnostic text is relayed verbatim into the
refusal -- never parsed or pattern-matched -- since em owns that format and
can change it freely. One gate implementation (em's), not two.

### `infrastructure-context.md`: a configurable narrowing hint

When enabled, the events-first check narrows its search for a required event's type
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
positive-path compile assertions against a *real* compiler are gated on a
`hasTsp()` helper (mirroring `hasEm()`) and skip gracefully when
`@typespec/compiler`'s `tsp` binary isn't installed.
`fixtures/fake-tsp/fake-tsp.mjs` stands in for the compiler under a
`--mode=` flag (clean exit, TypeSpec's `import-not-found` diagnostic, a
genuine compile diagnostic, exit 127), so the resolver, each failure class,
and the configured-`tspCommand` path are tested deterministically in every
environment (#25).

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
installed `em`. `em-sdd-mark-implemented` is now a thin wrapper with nothing
left to unit-test in isolation from `em` itself, so
`src/test/mark-implemented.cli.test.ts` shells out to the real installed
`em` throughout, `hasEm()`-gated like every other em-dependent test in this
suite, so CI (which deliberately does not install `em`) skips it instead of
failing.
