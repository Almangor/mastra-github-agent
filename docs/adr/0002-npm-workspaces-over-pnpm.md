# ADR-0002: npm workspaces instead of a pnpm lockfile

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Plan §6 requires a "frozen pnpm lockfile" as part of the supply-chain controls. The
repository was already an npm project with a committed `package-lock.json`.

## Decision

Use npm workspaces with `package-lock.json` (lockfileVersion 3) and `npm ci` in CI.

## Consequences

The controls plan §6 actually asks for are all preserved:

| Requirement | How it is met |
|---|---|
| Pin exact versions | `save-exact=true` in `.npmrc`; enforced by `scripts/check-supply-chain.mjs` |
| Frozen lockfile | `package-lock.json` v3 committed; CI uses `npm ci` |
| Block affected versions | `scripts/blocked-packages.json`, checked across the whole resolved tree |
| Default-deny install scripts | `ignore-scripts=true` in `.npmrc`, asserted by the gate |
| Verify provenance | `npm audit signatures` via `npm run supply-chain -- --signatures` |
| SBOM | `npm sbom --sbom-format cyclonedx` |

The one genuine difference is ecosystem, not guarantee. Switching to pnpm later is
a lockfile regeneration plus a CI line, and the gate script reads
`package-lock.json` in exactly one place.
