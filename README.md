# CEO Agent

An executive operating system built on [Mastra](https://mastra.ai) and Claude: a supervisor agent,
nine read-only specialists, eleven business workflows, approval-gated tools, six-layer memory, and a
self-learning pipeline that structurally cannot publish.

Implemented from [`plan.md`](./plan.md). Every command and every output block below was executed on
this repository — nothing is illustrative.

---

## Requirements

Node.js 20.9 or newer. Verified on Node v22.22.2 / npm 10.9.7.

```bash
git clone https://github.com/Almangor/mastra-github-agent.git ceo-agent
cd ceo-agent
npm install
```

**No API key is needed to run everything in the next section.** The security model, the workflows and
the release gates are all verifiable offline. A key is only needed when you want the agent to
actually think — see [Going live](#going-live).

---

## Run it

### 1. Prove it works — `npm run evals`

130 cases including 122 safety-gate cases, offline, in single-digit milliseconds.

```
$ npm run evals

CEO agent release gates — dataset 2026.08.02-1

  ✓ contract          8/8   100.0%  (needs 100%)
  – trajectory      no executable cases (model-dependent)
  – answer_quality  no executable cases (model-dependent)
  ✓ memory            7/7   100.0%  (needs 100%)
  ✓ workflow          8/8   100.0%  (needs 100%)
  ✓ security         53/53  100.0%  (needs 100%)
  – learning        no executable cases (model-dependent)
  ✓ promotion        54/54  100.0%  (needs 100%)

  ✓ hard gates      122/122 safety cases passed

  ! 15 model-dependent case(s) not run (need ANTHROPIC_API_KEY): trajectory, answer_quality
    These are declared in the dataset and reported as skipped — never as passes.

  dataset: 145 cases (130 executable, 15 model-dependent, 123 gates)
  ran 130 executable cases in 7ms

RELEASE GATES PASSED
```

The 15 model-dependent cases are **reported as skipped, never counted as passes**. `--json` gives the
same result machine-readable, for CI annotations.

### 2. See the security model — `npm run demo`

Four scenarios through the real admission path, with a stub model so no key is required.

```
$ npm run demo

CEO agent — Slack turn pipeline (stub model)

  CEO asks a question in a DM
    → ok  [stub model] I would answer: "What is our runway?" …
    Admitted: on the allowlist, DM surface, trusted.

  Someone not on the allowlist asks the same question
    → denied  You are not authorised to use the CEO agent.
    Denied: Slack says they are a valid workspace member; our policy says they are nobody.

  Slack redelivers the CEO event after a timeout
    → duplicate  (no output — suppressed)
    Suppressed: same event id, so the work does not run twice.

  Question arrives in an externally-shared channel
    → denied  The CEO agent does not operate in Slack Connect conversations.
    Denied: Slack Connect is off by default.

Gated write: approval card

    summary        Create Linear issue in ENG: "Migrate billing worker" (priority 2)
    tier           tier2_business_write
    blast radius   linear · reversible
    approvable by  exec or ceo (the requester cannot self-approve)
    args hash      d8c10350dd1c929b… (re-checked at release; a changed argument invalidates the approval)
```

Pass your own question: `npm run demo -- "What changed this week?"`

### 3. Open the playground — `npm run dev`

Starts Mastra Studio on <http://localhost:4111>. It registers **10 agents and 11 workflows**.

What you can do there without a key:

- **Agents** — all ten, with their tool counts. Finance Agent holds exactly 2 tools, the CEO
  Supervisor 13. Each specialist shows the subagent model (`claude-sonnet-5`); the supervisor shows
  `claude-opus-5`.
- **Tools** — all 13 guarded tools. `linear.createIssue` describes itself as *"a gated write: it will
  be sent for human approval before anything is created."*
- **Workflows** — click `decision-memo` to see its graph (`frame → options → await_decision`), then
  **Run** it with:

  ```json
  { "workspaceId": "T_ACME", "input": { "question": "Should we open a US entity this quarter?" } }
  ```

  It completes in ~3 ms and returns:

  ```json
  {
    "result": {
      "stepId": "await_decision",
      "outcome": "suspend",
      "detail": "recommendation ready for the CEO → awaiting ceo_decision",
      "state": { "question": "Should we open a US entity this quarter?", "__workspaceId": "T_ACME" }
    }
  }
  ```

  The memo cannot decide. That is the point of a memo.

> **Submitting a tool from the Tools page fails on purpose.** You get `Error executing dev tool`, and
> the server log says `no active turn: a guarded tool was invoked outside of a request context`. A
> guarded tool cannot execute without an authenticated identity — not even from the dev UI.

### 4. Run a business process — `npm run worker`

With no arguments it prints the durable schedule:

```
$ npm run worker

Durable job schedule (plan §2 — Inngest owns scheduled, restart-safe work)

  daily-executive-briefing     30 6 * * 1-5 Europe/Riga     → daily-briefing
                               Assemble and deliver the morning executive brief.
  weekly-operating-review      0 16 * * 5 Europe/Riga       → weekly-operating-review
                               Compile the weekly operating review across all functions.
  commitment-tracking          0 9 * * 1-5 Europe/Riga      → commitment-tracking
                               Chase commitments approaching or past their due date.
  …

  7 jobs · concurrency keyed per workspace
  run one:  npm run worker -- --run <workflowId>
  with input:  npm run worker -- --run decision-memo --input '{"question":"..."}'
```

Run one. With an empty executive store, the briefing correctly reports there is nothing to say
rather than manufacturing content:

```
$ npm run worker -- --run daily-briefing

{
  "workflowId": "daily-briefing",
  "status": "skipped",
  "trace": [
    { "stepId": "gather", "outcome": "continue" },
    { "stepId": "triage", "outcome": "skip", "detail": "nothing material since the last brief" }
  ]
}
```

Processes that need an argument take `--input`:

```
$ npm run worker -- --run incident-mode --input '{"description":"Payments API returning 500s"}'

{
  "workflowId": "incident-mode",
  "status": "suspended",
  "awaiting": "comms_approval",
  "trace": [
    { "stepId": "establish", "outcome": "continue" },
    { "stepId": "comms_draft", "outcome": "suspend", "detail": "incident comms drafted, awaiting release" }
  ]
}
```

Incident comms are irreversible once sent, so a human releases them.

Exit codes distinguish "waiting on a person" from "broken", so a scheduler does not page anyone for
a normal suspension:

| Status | Exit | Meaning |
|---|---|---|
| `suspended` | 0 | Waiting on a human decision |
| `skipped` | 0 | Nothing material to report |
| `failed` | 1 | Genuine failure — investigate |

### 5. Inspect governance — `npm run admin`

Four views: `policy`, `approvals`, `skills`, `gates`.

`npm run admin skills` prints the complete skill transition table. The bullet marks every edge the
learning reviewer is allowed to drive — it reaches `candidate` and `proposed`, and nothing else:

```
$ npm run admin skills

Who may drive a skill transition  — the reviewer appears only on proposal edges

  • observed           → candidate          learning_reviewer
    observed           → rejected           human_approver, curator
  • candidate          → proposed           learning_reviewer
    candidate          → superseded         curator
    candidate          → rejected           human_approver, curator
    proposed           → validating         validator
    proposed           → rejected           human_approver
    proposed           → superseded         curator
    validating         → awaiting_approval  validator
    validating         → failed             validator
    awaiting_approval  → canary             human_approver
    awaiting_approval  → rejected           human_approver
    canary             → active             human_approver, validator
    canary             → rolled_back        rollback_monitor, human_approver
    canary             → failed             validator
    active             → stale              curator
    active             → superseded         curator, human_approver
    active             → rolled_back        rollback_monitor, human_approver
    stale              → active             curator
    stale              → archived           curator, human_approver
  • failed             → candidate          learning_reviewer
    superseded         → archived           curator
  • rolled_back        → candidate          learning_reviewer
    rolled_back        → archived           curator, human_approver
```

Four bulleted edges out of twenty-four. Nothing the reviewer can reach publishes anything.

`npm run admin policy` shows the effective allowlist and the tier matrix:

```
  tier0_read             invoke: ceo,exec,staff,observer,system approve: n/a (ungated)
  tier1_internal_write   invoke: ceo,exec,staff,system          approve: n/a (ungated)
  tier2_business_write   invoke: ceo,exec,staff,system          approve: exec,ceo
  tier3_critical         invoke: ceo,exec                       approve: ceo
```

### 6. Everything at once — `npm run verify`

The full chain, in the order CI runs it: supply chain → boundaries → typecheck → gates.

```
$ npm run verify

  ✓ All 11 root dependencies are pinned to exact versions
  ✓ None of the 1 blocked package versions are present in the tree
  ✓ Frozen lockfile present (lockfileVersion 3); CI must install with `npm ci`
  ✓ Dependency install scripts are denied by default (.npmrc ignore-scripts=true)
  ✓ Every third-party lockfile entry carries an integrity hash
  ✓ No package-install capability reachable from apps/ or libs/ source
supply-chain: 6 passed, 2 warning(s), 0 failure(s)

  ✓ 86 internal dependency edges, all within the layer constraints
  ✓ no deep imports — every cross-package import goes through a package root
  ✓ dependency graph is acyclic
boundaries: clean across 24 packages

  ✓ hard gates      122/122 safety cases passed
RELEASE GATES PASSED
```

---

## Going live

### Add a model key

```bash
cp .env.example .env
# replace the sk-ant-... placeholder with a real key
```

Then `npm run dev` gives you a working chat in Studio, and:

```bash
npm run demo -- --live "What is our runway?"
```

Without a real key that command stops with a message rather than a stack trace:

```
$ npm run demo -- --live

--live needs a real ANTHROPIC_API_KEY.
Copy .env.example to .env and replace the sk-ant-... placeholder with a key
from https://console.anthropic.com/settings/keys — then re-run.
```

> **Not verified here.** This repository was built and tested without a live key, so the model's
> actual judgement — routing, answer quality, tool selection — has not been exercised. Wiring, model
> routing and tool registration are verified; what the model decides is not.

### Configure who may use it

`config/access-policy.json` is the allowlist. It ships with placeholders and **denies everything
until you edit it** — a missing or malformed file also denies everything, deliberately. The shipped
file, with one of its three example users elided:

```json
{
  "workspaces": [
    {
      "workspaceId": "T_REPLACE_ME",
      "label": "Example workspace — replace before use",
      "allowSlackConnect": false,
      "users": [
        { "userId": "U_REPLACE_CEO", "role": "ceo", "label": "Chief Executive" },
        { "userId": "U_REPLACE_EXEC", "role": "exec", "label": "Exec team" }
      ],
      "channels": [
        { "channelId": "C_REPLACE_EXEC", "policy": "trusted", "label": "#exec" },
        { "channelId": "C_REPLACE_LEADS", "policy": "restricted", "label": "#leads (may contain guests)" }
      ]
    }
  ]
}
```

Replace the ids with real Slack ids, then check your work with `npm run admin policy`.

Roles are ours, never read from Slack group membership. A `restricted` channel gets summaries instead
of quotes; an `external` channel is read-only no matter who is asking.

### Connect integrations

Every integration is optional. An unbound one reports itself disabled rather than inventing a number.

| Variable | Enables | Status |
|---|---|---|
| `GITHUB_TOKEN` | 3 GitHub read tools | implemented, exercised live |
| `LINEAR_API_KEY` | Linear reads + the gated `createIssue` write | implemented |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | calendar read + gated hold | tool surface only ([ADR-0006](./docs/adr/0006-unbound-integrations.md)) |
| `CRM_API_KEY` | pipeline + at-risk deals | tool surface only |
| `FINANCE_API_KEY` | cash position + spend | tool surface only |

GitHub works with no token at all, on the anonymous 60 requests/hour budget.

### Serve Slack

Set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`, then call `handleSlackTurn()` from your HTTP
handler. **Acknowledge Slack before awaiting it** — Slack retries after three seconds, and the
acknowledgement has to come first:

```ts
import { compose, handleSlackTurn } from '@ceo/runtime';

const composition = compose();

app.post('/slack/events', async (req, res) => {
  res.status(200).send();                     // 1. acknowledge first

  await handleSlackTurn({                     // 2. then do the work
    composition,
    envelope: { /* eventId, teamId, userId, channelType, text, … */ },
    signature: { rawBody: req.rawBody, timestamp: req.get('x-slack-request-timestamp'), signature: req.get('x-slack-signature') },
    runAgent: async ({ prompt, agentId }) => (await composition.agents[agentId].generate(prompt)).text,
  });
});
```

> The turn pipeline is complete and tested; the HTTP listener above is the one piece this repository
> does not ship. `signature.rawBody` must be the raw bytes — re-serialised JSON will not verify.

---

## Command reference

| Command | Needs a key | What it does |
|---|---|---|
| `npm run evals` | no | 130 cases, 122 safety gates. Exit 1 blocks a release. |
| `npm run demo` | no | Slack turn pipeline, stub model |
| `npm run demo -- --live "…"` | **yes** | Same pipeline, real agent |
| `npm run dev` | no to browse | Mastra Studio on :4111 |
| `npm run worker` | no | Durable job schedule |
| `npm run worker -- --run <id> [--input '{…}']` | no | Run one workflow |
| `npm run admin <policy\|approvals\|skills\|gates>` | no | Operator views |
| `npm run verify` | no | supply chain → boundaries → typecheck → gates |
| `npm run supply-chain -- --signatures` | no | Adds npm provenance (needs network) |
| `npm run sbom` | no | CycloneDX SBOM |

---

## Extending it

### Add a business tool

One `defineBusinessTool` call. The descriptor is the security contract. This is the real
`linear.createIssue` from `libs/integrations-linear/src/index.ts`, with the input schema and body
abridged — the descriptor block is verbatim:

```ts
const createIssue = defineBusinessTool(
  {
    descriptor: {
      id: 'linear.createIssue',
      tier: 'tier2_business_write',
      summary: 'Create a Linear issue',
      system: 'linear',
      reversible: true,
      // Never offered in an external channel; the guard also enforces this.
      allowedSurfaces: ['dm', 'channel', 'scheduled'],
    },
    description:
      'Create a Linear issue. This is a gated write: it will be sent for human approval before anything is created. State the intended title and team precisely.',
    inputSchema: z.object({ teamKey: z.string(), title: z.string().min(1) /* … */ }),
    // Shown verbatim on the approval card, so it must describe the real effect.
    renderSummary: a => `Create Linear issue in ${a.teamKey}: "${a.title}"`,
    execute: async args => { /* only reached after the guard allows */ },
  },
  getRuntime,
);
```

Register it in `buildToolCatalogue()` (`libs/ceo-agents/src/build.ts`). To give a specialist access,
add the id to its roster entry — but a specialist declares `maxTier: 'tier0_read'`, so handing it a
write tool **fails the build**:

```
ToolBoundaryViolation: agent "rogueAgent" may not hold tool "linear.createIssue":
tool is tier2_business_write but the agent's ceiling is tier0_read
```

### Add a workflow

Add a `WorkflowDefinition` in `libs/ceo-workflows/src/processes.ts`. Steps return
`step.continue(…)`, `step.skip(reason)`, `step.fail(error)` or `step.suspend(reason, awaiting)`. It
becomes runnable in all three places at once — `npm run worker -- --run`, the eval harness, and
Mastra Studio — because the definition imports neither runner.

---

## How it fits together

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

**Slack is the control plane, not the authorization system.** Slack says who is speaking and where.
It does not say what they may do. Role and channel policy are re-derived from our own allowlist every
turn, so a valid Slack user the bot happens to share a channel with is still nobody.

**Authority is structural, not instructional.** A prompt saying "do not publish skills" is not
enforcement. The learning reviewer's output type has no publish variant, the transition table lists
it on four edges that all end at `candidate` or `proposed`, and its tools are filtered to read-only
before it is constructed. All three are asserted by the eval suite.

### Layout

24 packages, with dependency constraints enforced by `scripts/check-boundaries.ts`:

```
apps/    ceo-runtime · ceo-worker · ceo-admin · ceo-evals
libs/    ceo-contracts · ceo-domain · ceo-policy · ceo-agents · ceo-workflows
         ceo-memory · ceo-learning · ceo-skills · ceo-eval-kit
         integrations-{slack,linear,github,google,crm,finance}
         platform-{mastra,inngest,db,observability,config}
```

The constraint that carries the weight: **`domain` may not import a platform or an integration**, so
authorization stays pure and the 53 security cases run offline in milliseconds.
See [ADR-0003](./docs/adr/0003-layering-and-boundaries.md).

---

## What is not wired

Stated plainly so you can judge the gap:

- **Live model behaviour.** Not exercised — this was built without a key.
- **Google, CRM, finance vendors.** Full gated tool surface; no vendor bound ([ADR-0006](./docs/adr/0006-unbound-integrations.md)).
- **Slack HTTP listener.** Turn pipeline complete and tested; the Express binding is not shipped.
- **Inngest deployment.** Job definitions and schedule complete; the durable runner is not deployed.
- **Postgres.** `InMemoryExecutiveStore` implements the interface a LibSQL/Postgres store slots into.

Design decisions and their reasoning are in [`docs/adr/`](./docs/adr/) — including
[ADR-0001](./docs/adr/0001-reconstructed-from-summary.md), which records that the full 13,558-word
specification referenced by `plan.md` was unavailable and this was reconstructed from its summary.

## License

MIT
