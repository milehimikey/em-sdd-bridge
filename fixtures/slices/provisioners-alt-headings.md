---
schemaVersion: 1
pattern: state-view
swimlane: Operator → Provisioning
status: ready-to-implement
version: 1
---
# State View Slice: Provisioners

## Purpose
Let an Operator see every provisioner currently registered, with its last heartbeat, so stale ones can be spotted.

## Read Trigger
The Operator opens the Provisioners screen; refreshed on every heartbeat.

## Source Events
- Provisioner Registered
- Provisioner Heartbeat Received
- Provisioner Retired

## Read Model
- **Read Model:** `Provisioners`
- **Consumed by:** the Provisioners screen and the Stale Provisioner Sweep automation
- **Freshness:** eventual

## Invariants
- **INV-EO-1:** A retired provisioner never appears in the list.
- **INV-ACCT-19:** Heartbeats older than 5 minutes mark the provisioner stale.

## Scenarios
- **Happy path** — Given two provisioners have registered, When the Operator opens Provisioners, Then both appear with their last heartbeat.
- **Rejected (INV-EO-1)** — Given a provisioner has retired, When the Operator opens Provisioners, Then it is absent from the list.
- **Edge: stale** — Given a provisioner's last heartbeat is 6 minutes old, When the view is read, Then it is flagged stale (INV-ACCT-19).

## Alternate Flows
- No provisioners registered yet: the list renders empty.

## NFRs
- **Security / authz:** Operators only.
- **PII & compliance:** none
- **Performance / SLA:** none

## Questions
- [x] Should retired provisioners be shown greyed out instead? Resolved: no.
