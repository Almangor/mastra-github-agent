# ADR-0001: Implementation reconstructed from the plan summary

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

`plan.md` summarises a 13,558-word specification and links to it as
`sandbox:/mnt/data/super_elite_ceo_agent_plan.md`. That link is dead — it points into
the sandbox of the session that produced the summary, and the file is not on disk
or anywhere in this repository.

The summary names all 25 sections of the full document but contains none of their
contents. Specifically missing: the RequestContext schema, the tool-risk tier
definitions, the database entity definitions, the six-layer memory specification,
the eval dataset (~395 cases), the Nx project tags and dependency constraints, and
the illustrative Mastra code.

## Decision

Implement against the summary's architecture and its six resolved decisions,
reconstructing the missing detail from first principles, and record every
gap-filling choice as an ADR in this directory.

## Consequences

- The architecture, the security model, the learning governance model and the
  execution-surface boundary all follow the plan directly — these are stated in the
  summary in enough detail to implement faithfully.
- Schema shapes, tier names, eval case ids and dataset composition are **our own**
  and will differ from the original document.
- Anyone holding the full specification should diff it against `libs/ceo-contracts`
  first: contracts are where divergence matters most, since everything else keys
  off them.
