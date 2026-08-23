---
schemaVersion: 1
pattern: automation
swimlane: (system) → Notifications
status: ready-to-implement
version: 1
---
# Slice: Send Notification

## Intent
Automatically notify a channel whenever a ping is recorded, as the walking skeleton's automation example. As of the merged Automation shape (`em` >=1.7.1), the reaction, the command it triggers, and the event that command emits all live in this one slice.

## Trigger & Actor
Internally triggered: reacts to the Pings To Notify read model (built from Ping Recorded, in the slice before this one) via the Notify On Ping processor, which triggers the Send Notification command in this same slice; never called directly by a human actor.

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
<!-- omitted: this slice CONSUMES the Pings To Notify read model (built in
     the slice before), it does not produce a read model of its own. -->

## Invariants / Business Rules
- **INV-1:** Every Ping Recorded event triggers exactly one Send Notification command (no duplicate notifications for the same ping).
- **INV-2:** Reject Send Notification when pingId does not reference a known ping.

## Scenarios (Given / When / Then)
- **Happy path** — Given a Ping Recorded event lands, When the Notify On Ping automation observes it via Pings To Notify, Then it triggers Send Notification for that ping and a Notification Sent event is emitted.
- **Rejected (INV-2)** — Given no ping exists for pingId, When Send Notification is triggered, Then the command is rejected with a validation error; no event.

## Alternate & Error Flows
- Idempotency: if Send Notification is triggered twice for the same pingId (e.g. automation redelivery), the second call is accepted and emits a second Notification Sent event — deduplication is out of scope for this slice.

## Non-Functional Requirements
- **Security / authz:** none — internal system reaction, not caller-invoked.
- **PII & compliance:** none
- **Performance / SLA:** none

## Dependencies & Read Models Affected
- **Upstream events this slice relies on:** Ping Recorded (via the Pings To Notify read model)
- **Downstream read models / slices affected:** none

## Open Questions
<!-- none -->
