---
schemaVersion: 1
pattern: automation
swimlane: (system) → Pings
status: ready-to-implement
version: 1
---
# Slice: Pings To Notify

## Intent
Automatically notify a channel whenever a ping is recorded, as the walking skeleton's automation example (reaction half of the Automation pair with Send Notification).

## Trigger & Actor
Internally triggered: reacts to the Pings To Notify read model, which is fed by Ping Recorded. Triggers the `Send Notification` command in the next slice.

## Read Model / View
- **View:** `Pings To Notify` built from events: "Ping Recorded"
- **Consumed by:** the Notify On Ping automation
- **Freshness / consistency expectation:** real-time

## Invariants / Business Rules
- **INV-1:** Every Ping Recorded event triggers exactly one Send Notification command (no duplicate notifications for the same ping).

## Scenarios (Given / When / Then)
- **Happy path** — Given a Ping Recorded event lands, When the Notify On Ping automation observes it via Pings To Notify, Then it triggers Send Notification for that ping.

## Alternate & Error Flows
- If the downstream Send Notification command fails, the automation retries per the platform's standard at-least-once redelivery (no slice-specific compensation defined).

## Non-Functional Requirements
- **Security / authz:** none — internal system reaction, not caller-invoked.
- **PII & compliance:** none
- **Performance / SLA:** none

## Dependencies & Read Models Affected
- **Upstream events this slice relies on:** Ping Recorded
- **Downstream read models / slices affected:** Send Notification (next slice)

## Open Questions
<!-- none -->
