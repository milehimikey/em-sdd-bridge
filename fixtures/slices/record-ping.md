---
schemaVersion: 1
pattern: state-change
swimlane: Integrator → Pings
status: ready-to-implement
version: 1
---
# Slice: Record Ping

<!-- Legacy body-label bullets, kept solely for mark-implemented-doc.ts's
     STATUS_RE/IMPLEMENTED_IN_RE (out of scope for MIL-94, still regex-edits
     these lines directly). em/the bridge itself now reads status/pattern
     from the frontmatter above, not from these -- editing them here does
     NOT flip the doc's real status; only frontmatter does. -->
- **Status:** ready-to-implement
- **Implemented in:**

## Intent
Give the Integrator a way to record that a ping happened, so the walking skeleton has a real, auditable write path end to end. This is the throwaway subject for the Phase 1 walking skeleton (goal-spec: RecordPing -> PingRecorded -> RecentPings).

## Trigger & Actor
The Integrator submits a ping from the Ping Console whenever they want to record a heartbeat.

## Command / Input
**Command:** `Record Ping`

| Field | Type | Required | Rules / Validation |
|-------|------|----------|--------------------|
| postedAt | Instant | yes | Must not be in the future relative to server time. |
| source | string | yes | Non-empty; max 200 characters. |

## Event(s) Emitted
**Event:** `Ping Recorded` → context `Pings`

| Field | Type | Immutable Fact? | Source / Notes |
|-------|------|-----------------|----------------|
| postedAt | Instant | yes | Copied verbatim from the command. |
| source | string | yes | Copied verbatim from the command. |

## Read Model / View
<!-- omitted: pure State Change slice, no view produced here -->

## Invariants / Business Rules
- **INV-1:** Reject Record Ping when postedAt is in the future.

## Scenarios (Given / When / Then)
- **Happy path** — Given no prior pings, When the Integrator records a ping with a valid postedAt and source, Then a Ping Recorded event is emitted and Recent Pings reflects it.
- **Rejected (INV-1)** — Given the current server time, When the Integrator records a ping with postedAt in the future, Then the command is rejected with a validation error; no event.

## Alternate & Error Flows
- Duplicate submissions with the same postedAt and source are accepted as distinct pings (no idempotency key defined for this slice).

## Non-Functional Requirements
- **Security / authz:** Any authenticated Integrator caller may invoke this command.
- **PII & compliance:** none
- **Performance / SLA:** none

## Dependencies & Read Models Affected
- **Upstream events this slice relies on:** none
- **Downstream read models / slices affected:** Recent Pings

## Open Questions
- [x] Should postedAt default to server-received time if omitted? Resolved: no, it is always required from the caller.
