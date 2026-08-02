# ADR-0004: Three model roles

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

The plan does not specify model selection.

## Decision

Three roles, configured in `@ceo/platform-config` and resolved in
`@ceo/platform-mastra`:

| Role | Default | Why |
|---|---|---|
| `supervisor` | `claude-opus-5` | Long-horizon synthesis across specialists; highest stakes |
| `subagent` | `claude-sonnet-5` | Narrow brief, bounded tool surface |
| `reviewer` | `claude-sonnet-5` | Runs on every turn; proposal-only authority |

## Consequences

- A model migration is one file.
- The eval harness can pin models per run.
- The reviewer running on a cheaper model is safe precisely because its authority
  is bounded structurally rather than by capability.
