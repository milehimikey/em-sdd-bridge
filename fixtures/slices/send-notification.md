---
schemaVersion: 1
pattern: state-change
swimlane: (system) → Notifications
status: ready-to-implement
version: 1
---
# Slice: Send Notification

## Intent
Record that a notification was sent for a given ping — the command half of the Pings To Notify / Send Notification Automation pair.

## Trigger & Actor
Triggered internally by the Notify On Ping automation (Pings To Notify slice); never called directly by a human actor.

## Command / Input
**Command:** `Send Notification`

| Field | Type | Required | Rules / Validation |
|-------|------|----------|--------------------|
| pingId | UUID | yes | Must reference a ping that exists (a prior Ping Recorded event). |
| channel | string | yes | Non-empty; must be a configured notification channel. |

## Event(s) Emitted
**Event:** `Notification Sent` → context `Notifications`

| Field | Type | Immutable Fact? | Source / Notes |
|-------|------|-----------------|----------------|
| pingId | UUID | yes | Copied verbatim from the command. |
| channel | string | yes | Copied verbatim from the command. |

## Read Model / View
<!-- omitted: pure State Change slice, no view produced here -->

## Invariants / Business Rules
- **INV-1:** Reject Send Notification when pingId does not reference a known ping.

## Scenarios (Given / When / Then)
- **Happy path** — Given a Ping Recorded event exists for pingId, When Send Notification is triggered, Then a Notification Sent event is emitted.
- **Rejected (INV-1)** — Given no ping exists for pingId, When Send Notification is triggered, Then the command is rejected with a validation error; no event.

## Alternate & Error Flows
- Idempotency: if Send Notification is triggered twice for the same pingId (e.g. automation redelivery), the second call is accepted and emits a second Notification Sent event — deduplication is out of scope for this slice.

## Non-Functional Requirements
- **Security / authz:** none — internal system command, not caller-invoked.
- **PII & compliance:** none
- **Performance / SLA:** none

## Dependencies & Read Models Affected
- **Upstream events this slice relies on:** Ping Recorded
- **Downstream read models / slices affected:** none

## Open Questions
<!-- none -->
