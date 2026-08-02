# ADR-0006: Unbound integrations fail loudly instead of fabricating

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Google Workspace, CRM and finance have no vendor bound and no credentials in this
environment. GitHub and Linear are fully implemented.

## Decision

Every unbound integration ships its **real tool surface** — descriptor, risk tier,
zod schema, approval gating — and returns an explicit `integration_disabled` result
whose message instructs the agent to report the gap rather than estimate.

Where an implementation would require an untested OAuth exchange, the tool throws a
named error referencing this ADR rather than shipping an unverified auth path.

## Consequences

- The authorization model is exercised uniformly: a finance tool is gated the same
  way whether or not a vendor is bound.
- The agent never invents a cash figure. `finance.cashPosition` is restricted to DM
  and scheduled surfaces even when disabled, so wiring a vendor later cannot
  accidentally widen its audience.
- Binding a vendor is a change to one `execute` body.
