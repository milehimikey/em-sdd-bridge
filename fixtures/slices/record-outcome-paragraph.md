---
schemaVersion: 1
pattern: state-change
swimlane: Provisioner → Executions
status: draft
version: 1
---
# Slice: Record Outcome

## Intent
Record the outcome of a completed execution so callers can fetch it by id.

## Command / Input
**Command:** `Record Outcome`

| Field | Type | Required | Rules / Validation |
|-------|------|----------|--------------------|
| executionId | UUID | yes | Must reference a started execution. |

## Event(s) Emitted
**Event:** `Outcome Recorded` → context `Executions`

## Invariants / Business Rules
- **INV-RO-1:** Reject Record Outcome when the execution has not started.

## Scenarios

**Outcome recorded for a completed execution**

- **Given** an execution that has started
- **When** the provisioner records an outcome
- **Then** the outcome is stored and returned by id

**Rejected (INV-RO-1): execution not started**

- **Given:** an execution that has not started
- **When:** the provisioner records an outcome
- **Then:** the command is rejected; no event
