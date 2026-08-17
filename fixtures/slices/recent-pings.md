---
schemaVersion: 1
pattern: state-view
swimlane: Integrator → Pings
status: ready-to-implement
version: 1
---
# Slice: Recent Pings

## Intent
Let the Integrator see the most recent pings recorded, so they can confirm the walking skeleton's write path actually took effect.

## Trigger & Actor
The Integrator opens the Recent Pings view at any time; no command is involved.

## Event(s) Emitted
<!-- omitted: pure State View slice, no event recorded here -->

## Read Model / View
- **View:** `Recent Pings` built from events: "Ping Recorded"
- **Consumed by:** the Recent Pings View screen
- **Freshness / consistency expectation:** eventual

## Invariants / Business Rules
<!-- none for a pure read slice -->

## Scenarios (Given / When / Then)
- **Happy path** — Given a Ping Recorded event has landed, When the Integrator opens Recent Pings, Then the ping appears in the list within the freshness window.

## Alternate & Error Flows
- If no pings have ever been recorded, the view renders empty rather than erroring.

## Non-Functional Requirements
- **Security / authz:** Any authenticated Integrator caller may read this view.
- **PII & compliance:** none
- **Performance / SLA:** none

## Dependencies & Read Models Affected
- **Upstream events this slice relies on:** Ping Recorded
- **Downstream read models / slices affected:** none

## Open Questions
<!-- none -->
