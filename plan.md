# Super-Elite CEO Agent Plan

I produced a 13,558-word, implementation-ready specification for Claude covering architecture, Slack UX, Mastra, Nx boundaries, Inngest workflows, memory, evals, security, deployment, and Hermes-style self-learning.

[Download the complete CEO Agent implementation plan](sandbox:/mnt/data/super_elite_ceo_agent_plan.md)

## The central architecture

The system is designed as an executive operating system, not a single oversized agent:
Slack
-> identity, RBAC, thread scope, deduplication
-> CEO supervisor
-> strategy agent
-> operations agent
-> revenue agent
-> finance agent
-> product/engineering agent
-> people agent
-> research agent
-> risk agent
-> communications agent
-> deterministic Mastra workflows
-> Inngest durability and schedules
-> typed, approval-gated business tools
-> executive-state database
-> memory and versioned skills
-> eval, learning, canary, and rollback pipeline
...The production path uses a regular Mastra Agent as the CEO supervisor, focused subagents for specialist analysis, and workflows for processes where the steps must be predictable. AgentController and Mastra Goals are included as future feature-flagged experiments rather than critical dependencies because both are presently documented as beta.

## Major decisions already resolved

### 1. Slack is the control plane, not the authorization system

The plan specifies:

- Direct messages for private executive work.
- Channel mentions with thread-local memory.
- Different memory resources for DMs and shared channels.
- Explicit Slack workspace, user, role, and channel policies.
- Slack Connect denied by default.
- Block Kit approval cards.
- Event deduplication and idempotent processing.
- Immediate acknowledgement before any model work.

This application-level access layer is necessary because Mastra's Slack adapter does not include a built-in user allowlist; valid Slack users can otherwise invoke the agent wherever the bot is present.

### 2. Workflows own repeatable CEO processes

The specification fully defines:

- Daily executive briefing.
- Weekly operating review.
- Decision memo.
- Meeting preparation and follow-up.
- Commitment tracking.
- Delivery-risk review.
- Revenue/GTM review.
- Incident mode.
- Learning review.
- Skill curation and promotion.

Mastra workflows support persisted snapshots and suspension/resumption for human input, while Mastra supports Inngest as an external workflow runner.

The boundary is:

- Inngest: scheduled, durable, multi-minute, restart-safe business processes.
- Mastra background tasks: temporary within-turn research or subagent fan-out.
- Mastra workflows: canonical business-process definitions.

### 3. Hermes-style learning without uncontrolled self-modification

The plan reproduces the useful Hermes capabilities:

- Persistent memory.
- Deepening user profile.
- Search across previous conversations.
- Automatic post-run learning review.
- Creating skills from successful experience.
- Patching skills after corrections.
- Consent-aware memory and skill writes.
- Scheduled behavior.
- Skill usage tracking and curation.
- Active, stale, and archived skill states.

Hermes documents a post-turn background review that can save memory or update procedural skills, optional write approval, and a curator that tracks skill usage and moves unused skills through lifecycle states.

For the CEO agent, that becomes this governed state machine:
observed
-> candidate
-> proposed
-> validating
-> awaiting approval
-> canary
-> active

Any stage:
-> rejected
-> failed
-> superseded
-> rolled back

Active:
-> stale
-> archived
...The learning reviewer receives trace summaries and feedback but has proposal-only authority. It cannot access business write tools, modify core prompts, publish skills, or write directly into production.

Every learned skill requires:

1. Evidence from successful runs or explicit teaching.
2. Duplicate-skill detection.
3. Static and security validation.
4. Targeted evals.
5. Global regression evals.
6. Adversarial tests.
7. Approval according to risk.
8. Limited canary exposure.
9. Automatic rollback.

### 4. Evals are release gates

The plan defines an eval hierarchy covering:

- Deterministic unit and contract tests.
- Tool-selection trajectories.
- Executive answer quality.
- Multi-turn memory.
- Workflow restart and approval handling.
- Prompt injection and authorization attacks.
- Learning classification.
- Skill promotion and rollback.
- Production trace scoring.

Mastra currently supports CI evaluation with runEvals, hard gates and quality thresholds, versioned datasets, persisted experiments, memory-enabled evals, and scoring of historical traces.

Initial hard gates in the plan include:

- Zero unauthorized writes.
- Zero approval bypasses.
- Zero cross-tenant or DM-to-channel leakage.
- Zero secret leakage in the adversarial suite.
- 100% approval enforcement on gated actions.
- Zero production skill promotions without an eval record.
- Zero direct modification of core skills by the learning process.

The included initial dataset design contains roughly 395 cases plus 25 multi-turn scenarios, split across routing, briefs, decisions, commitments, memory, approvals, security, and learning.

### 5. Nx structure is implementation-ready

The document includes a complete proposed monorepo:
apps/
ceo-runtime
ceo-worker
ceo-admin
ceo-evals

libs/
ceo-contracts
ceo-domain
ceo-agents
ceo-workflows
ceo-memory
ceo-learning
ceo-skills
ceo-eval-kit
ceo-policy

integrations-slack
integrations-linear
integrations-github
integrations-google
integrations-crm
integrations-finance

platform-mastra
platform-inngest
platform-db
platform-observability
platform-config
...It also specifies project tags, dependency constraints, affected-project eval mappings, prompt versioning, and build targets. Mastra's monorepo documentation specifically notes that Nx workspace packages consumed by Mastra need their own package.json, and the Mastra build must run from the correct application package.

### 6. Supply-chain controls are mandatory

The plan intentionally does not tell Claude to blindly install latest. In June 2026, a compromised maintainer token was used to publish many malicious packages in the Mastra npm namespace; Mastra's incident report says 116 malicious packages were published during the event.

Claude is instructed to:

- Pin exact Mastra versions.
- Block known affected versions, including @mastra/core@1.42.1.
- Verify npm provenance against the corresponding GitHub release.
- Commit a frozen pnpm lockfile.
- Default-deny dependency install scripts.
- Produce an SBOM.
- Scan for malware, vulnerabilities, secrets, and licensing issues.
- Deploy immutable signed artifacts or image digests.
- Never allow the running agent to install packages.

## What is inside the document

The file contains 25 detailed sections, including:

- Product mandate and non-goals.
- Current Mastra architectural conclusions.
- Mermaid system diagram.
- Slack command and interaction design.
- RequestContext schema.
- Agent responsibilities and tool boundaries.
- Tool-risk tiers.
- Executive workflows.
- Database entities.
- Six-layer memory architecture.
- Explainable user-model claims.
- Mastra skill structure.
- Full Hermes capability mapping.
- Self-learning state machine.
- Eval datasets, scorers, gates, and thresholds.
- Observability and audit requirements.
- Prompt-injection and sandbox security.
- Reliability and recovery.
- Nx package tree and module boundaries.
- Illustrative Mastra code.
- CI/CD and Mac mini deployment.
- Delivery phases and exit criteria.
- Definition of done.
- Required ADRs.
- First implementation backlog.
- A ready-to-paste implementation prompt for Claude.

A good first instruction to Claude is:


Read the complete implementation specification. Inspect the existing Nx
repository, then implement Phase 0 only: ADRs, project boundaries, schemas,
policy contracts, dependency-provenance controls, test fixtures, and the
initial eval harness. Do not start Slack or connector integration until
Phase 0 format, lint, typecheck, unit tests, and deterministic evals pass.