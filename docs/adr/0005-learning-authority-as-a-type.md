# ADR-0005: The learning reviewer's authority is a type, not a prompt

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Plan §3 requires that the learning reviewer "cannot access business write tools,
modify core prompts, publish skills, or write directly into production."

A system prompt saying so is not an enforcement mechanism.

## Decision

Express the constraint in three structural ways:

1. **Output vocabulary.** `Proposal` is a discriminated union with exactly three
   members: `memory`, `skill`, `skill_patch`. There is no `publish` variant, so the
   reviewer cannot express the act.
2. **Transition table.** `TRANSITIONS` in `@ceo/contracts` lists `learning_reviewer`
   on edges reaching only `candidate` and `proposed`. `SkillRegistry.transition` is
   the sole mutation path and calls `assertTransition`.
3. **Tool filter.** `reviewerToolFilter` drops everything above `tier0_read` before
   the reviewer is constructed, so a write tool is never in its context.

## Consequences

- The promotion eval suite asserts the invariant exhaustively over the full
  state × state × actor space (54 cases), so a future edit that widens the
  reviewer's reach fails the release.
- This caught a real over-permission during implementation: `candidate → superseded`
  had been granted to the reviewer. Superseding is a curation act; the edge now
  belongs to `curator` alone, leaving the reviewer's reachable set at exactly
  `{candidate, proposed}`.
