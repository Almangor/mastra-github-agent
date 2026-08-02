# ADR-0003: Six-layer package graph with a pure policy layer

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Plan §5 specifies an Nx monorepo with project tags and dependency constraints but
does not enumerate them.

## Decision

Six layers, enforced by `scripts/check-boundaries.ts`:

```
contracts   → (nothing)
domain      → contracts
platform    → contracts, domain, platform
integration → contracts, domain, platform, integration
core        → contracts, domain, platform, integration, core
app         → anything
```

`ceo-policy` and `ceo-domain` sit in `domain`, so **the authorization layer cannot
import an integration or the platform**.

## Consequences

- Every security eval runs offline, in milliseconds, with no network and no stubs
  that could mask a real failure. This is why 53 security cases run on every commit.
- `platform` may depend on `domain` — `platform-mastra`'s guarded tool factory has
  to call `authorizeTool` to do its job. Same-layer edges are therefore allowed
  above `domain`, and acyclicity is checked separately.
- Relative imports that escape a package are treated as deep imports and rejected,
  which is what forced `apps/ceo-runtime` to export a package surface rather than
  letting the worker reach into its source.

An initial attempt used a stricter table (`platform → contracts` only). The checker
rejected the real code, which was the correct outcome — the rules were wrong, not
the code.
