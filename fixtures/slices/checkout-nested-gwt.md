---
schemaVersion: 1
pattern: state-change
swimlane: Shopper → Orders
status: ready-to-implement
version: 2
---
# Slice: Checkout

## Delta
**v1 → v2, ratified 2026-10-01** — added the negative-total rule.

### Added
#### Requirement: Negative totals are rejected (INV-CHK-3a)
Reject Checkout when the cart total is negative.
##### Scenario: negative total
- **Given:** a negative total
- **When:** the shopper checks out
- **Then:** rejected; no event.

## Intent
Let a shopper pay for the cart and turn it into an order.

## Trigger & Actor
The Shopper presses Pay on the cart page.

## Command / Input
**Command:** `Checkout`

| Field | Type | Required | Rules / Validation |
|-------|------|----------|--------------------|
| cartId | UUID | yes | Must reference an existing cart. |

## Event(s) Emitted
**Event:** `Checkout Completed` → context `Orders`

| Field | Type | Immutable Fact? | Source / Notes |
|-------|------|-----------------|----------------|
| cartId | UUID | yes | Copied verbatim from the command. |

## Read Model / View
<!-- omitted: pure State Change slice -->

## Invariants / Business Rules
- **INV-CHK-1:** Reject Checkout when the cart is empty.
  - Rationale: there is nothing to pay for; the UI should not offer Pay in this state.
- **INV-CHK-3a:** Reject Checkout when the cart total is negative.

## Scenarios (Given / When / Then)
- **Happy path**
  - **Given:** a cart with two items
  - **When:** the shopper checks out
  - **Then:** Checkout Completed is recorded and the Order Summary
    shows the new order.
- **Rejected (INV-CHK-1)**
  - **Given:** an empty cart
  - **When:** the shopper checks out
  - **Then:** rejected with reason; no event.
- **Rejected (INV-CHK-3a)**
  - **Given:** a negative total
  - **When:** the shopper checks out
  - **Then:** rejected; no event.
- **Stale cart**
  - **Given:** a cart modified after the page loaded
  - **When:** the shopper checks out
  - **Then:** the command is rejected with a stale-cart reason.
  - Note: the UI refreshes the cart and lets the shopper retry.

## Alternate & Error Flows
- Payment provider timeout → retry up to three times, then emit a Checkout Failed event.

## Non-Functional Requirements
- **Security / authz:** Shopper must own the cart.
- **PII & compliance:** none
- **Performance / SLA:** none

## Open Questions
<!-- none -->
