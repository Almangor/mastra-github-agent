# Super-Elite CEO Agent

An executive operating system built on [Mastra](https://mastra.ai) and Claude: a CEO
supervisor agent, nine specialist subagents, deterministic business workflows,
approval-gated business tools, six-layer memory, and a governed self-learning
pipeline — with the safety properties enforced by release gates that run on every
commit.

Implemented from [`plan.md`](./plan.md). See [ADR-0001](./docs/adr/0001-reconstructed-from-summary.md)
for what that summary did and did not contain.

## Try it in 30 seconds

```bash
npm install
npm run evals     # 130 offline cases, 122 safety gates — no API key needed
npm run demo      # the Slack turn pipeline, with a stub model
npm run admin gates
```

`npm run demo` walks four scenarios and shows an approval card:

```
  CEO asks a question in a DM
    → ok  …
  Someone not on the allowlist asks the same question
    → denied  You are not authorised to use the CEO agent.
  Slack redelivers the CEO event after a timeout
    → duplicate  (no output — suppressed)
  Question arrives in an externally-shared channel
    → denied  The CEO agent does not operate in Slack Connect conversations.
```

For the live agent, put an `ANTHROPIC_API_KEY` in `.env` and run `npm run dev`
(Mastra Studio) or `npm run demo -- --live "What is our runway?"`.

## The idea

The system is an executive operating system, not one large agent:

```
Slack ── verify ─ ack ─ dedup ─ admit ──▶ CEO supervisor
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
              9 specialists          11 workflows            gated business tools
           (read-only, narrow)   (suspend for humans)     (approval before effect)
                    │                        │                        │
                    └──────────── executive state · six-layer memory ─┘
                                             │
                                   governed learning pipeline
                              (proposes; never publishes)
```

Two ideas carry most of the weight.

**Slack is the control plane, not the authorization system.** Slack tells us who is
speaking and where. It does not tell us what they may do. `@ceo/policy` re-derives
role and channel policy from our own allowlist on every turn, so a valid Slack user
the bot happens to share a channel with is still nobody.

**Authority is structural, not instructional.** A prompt saying "do not publish
skills" is not enforcement. The learning reviewer's output type has no `publish`
variant, the skill transition table lists it on only two edges, and its tool set is
filtered to read-only before it is constructed. All three are asserted by the eval
suite.

## What runs

| Command | What it does |
|---|---|
| `npm run evals` | 130 executable cases, 122 safety gates. Offline, ~10ms. |
| `npm run demo` | Slack turn pipeline end to end (stub model by default) |
| `npm run dev` | Mastra Studio with all 10 agents |
| `npm run worker` | Durable job schedule; `-- --run <workflowId>` executes one |
| `npm run admin` | `policy` · `approvals` · `skills` · `gates` |
| `npm run verify` | supply-chain → boundaries → typecheck → gates |

## The seven hard release gates

Plan §4. Each is a predicate over evidence the runtime emits as a side effect of
doing its job — the audit log and the skill transition history — so a gate cannot be
satisfied by a component that merely claims compliance.

| | Gate |
|---|---|
| G1 | Zero unauthorized writes |
| G2 | Zero approval bypasses |
| G3 | Zero cross-tenant or DM-to-channel leakage |
| G4 | Zero secret leakage |
| G5 | 100% approval enforcement on gated actions |
| G6 | Zero skill promotions without an eval record |
| G7 | Zero core modification by the learning process |

A gate is not a threshold. One violation blocks the release; there is no percentage
that makes it acceptable.

## Approval-gated tools

Every tool that touches a real system is built by `defineBusinessTool`, so the
authorization check is inside the only constructor available:

```ts
defineBusinessTool({
  descriptor: {
    id: 'linear.createIssue',
    tier: 'tier2_business_write',
    reversible: true,
    allowedSurfaces: ['dm', 'channel', 'scheduled'],  // never external
  },
  inputSchema: z.object({ teamKey: z.string(), title: z.string(), … }),
  renderSummary: a => `Create Linear issue in ${a.teamKey}: "${a.title}"`,
  execute: async args => { /* only reached after the guard allows */ },
}, getRuntime);
```

The tier and the descriptor live in code. The `RequestContext` is injected by the
runtime. **Neither travels through the model** — a prompt injection can choose which
tool to call and with what arguments; it cannot change who is asking or what the
tool is allowed to do.

Approvals are records, not flags. Each one pins a sha256 of the canonicalised
arguments, which the executor recomputes at release time. Changing an argument after
approval invalidates it, and the requester cannot approve their own action.

## Layout

24 packages (plan §5), with dependency constraints enforced by
`scripts/check-boundaries.ts`:

```
apps/
  ceo-runtime      Slack control plane + Mastra agent runtime
  ceo-worker       durable, scheduled processes
  ceo-admin        operator CLI
  ceo-evals        release gates

libs/
  ceo-contracts    zod contracts — depends on nothing
  ceo-domain       executive entities
  ceo-policy       authorization, approval enforcement, redaction, dedup
  ceo-agents       supervisor + 9 specialists
  ceo-workflows    11 business processes
  ceo-memory       six-layer memory
  ceo-learning     governed learning state machine
  ceo-skills       versioned procedural memory
  ceo-eval-kit     scorers, datasets, gates

  integrations-{slack,linear,github,google,crm,finance}
  platform-{mastra,inngest,db,observability,config}
```

The constraint that carries the weight: **`domain` may not import a platform or an
integration**, so authorization stays pure and the 53 security cases run offline in
milliseconds. See [ADR-0003](./docs/adr/0003-layering-and-boundaries.md).

## Memory

Six layers, differing along three axes that matter operationally — how long content
survives, who may read it, and whether the agent may write it unattended:

| Layer | Scope | Agent may write |
|---|---|---|
| working | turn | yes |
| episodic | conversation | yes |
| semantic | workspace | with consent |
| profile | workspace | with consent |
| procedural | workspace | **no** — skills only, human-gated |
| organisational | workspace | with consent |

Partitions come from the `RequestContext`, never from an argument, so a caller
cannot ask for the DM partition while serving a channel turn. Profile claims carry
their evidence and compute confidence rather than asserting it, so the CEO can ask
why the agent believes something and correct it.

## Execution surfaces

Plan §2 draws the line; `executionSurfaceFor()` encodes it:

| Surface | For |
|---|---|
| Inngest | scheduled, durable, multi-minute, restart-safe |
| Mastra workflow | canonical business-process definitions |
| Mastra background task | within-turn research or subagent fan-out |

Workflow definitions import neither runner, so the same definition runs inline in an
eval and durably in the worker.

## Supply chain

Plan §6, after the June 2026 Mastra namespace compromise (116 malicious packages
published with a stolen maintainer token). `npm run supply-chain`:

```
✓ All 11 root dependencies are pinned to exact versions
✓ None of the 1 blocked package versions are present in the tree
✓ Frozen lockfile present (lockfileVersion 3); CI must install with `npm ci`
✓ Dependency install scripts are denied by default (.npmrc ignore-scripts=true)
✓ Every third-party lockfile entry carries an integrity hash
✓ No package-install capability reachable from apps/ or libs/ source
```

That last check greps the shipped source: a learned skill or an injected prompt that
can reach `npm install` would defeat everything above it.

## Configuration

Copy `.env.example` to `.env`. Only `ANTHROPIC_API_KEY` is required. Every
integration is optional — an unbound adapter reports itself disabled rather than
inventing a figure ([ADR-0006](./docs/adr/0006-unbound-integrations.md)).

Before serving Slack, replace the placeholder ids in `config/access-policy.json`.
A missing or malformed policy file denies everything.

## Status

Complete and verified: the monorepo and its gates, contracts, domain, policy, the
six-layer memory, all 10 agents with enforced tool boundaries, 11 workflows with
suspend/resume, the learning and skill lifecycle, the eval kit, and all four apps.

Not yet bound: Google/CRM/finance vendors (ADR-0006), a live Slack HTTP listener
(the turn pipeline is complete and tested; only the Express/Bolt binding is absent),
a durable Inngest deployment (definitions and schedule are complete; the runner is
not deployed), and Postgres (`InMemoryExecutiveStore` implements the interface a
LibSQL/Postgres store slots into).

The 15 model-dependent eval cases — routing judgement and answer quality — are
declared in the dataset and reported as **skipped** without an API key, never as
passes.

## License

MIT
