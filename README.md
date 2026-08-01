# Mastra GitHub Agent

A working AI agent built with [Mastra](https://mastra.ai) and Claude that answers questions
about any GitHub repository by calling the GitHub REST API through typed tools.

Ask it things like:

- *"Give me an overview of mastra-ai/mastra."*
- *"What are the oldest open bugs on vercel/ai?"*
- *"What changed in the last three releases of honojs/hono?"*
- *"Find me a popular TypeScript agent framework and summarise its recent commits."*

## How it works

```
  You ──▶ Mastra Agent ──▶ Claude (claude-opus-5)
                 │              │
                 │              └─▶ decides which tools to call
                 ▼
          5 typed tools ──▶ GitHub REST API
```

The agent is one `Agent` definition plus five `createTool` definitions. Claude picks which
tools to call and how to chain them; Mastra handles the tool loop, streaming, and memory.

| Tool | What it does |
| --- | --- |
| `get-repo` | Repository overview — stars, forks, language, license, topics |
| `list-issues` | Open/closed issues, filterable by label (pull requests excluded) |
| `list-releases` | Recent releases with trimmed release notes |
| `list-commits` | Recent commits on a branch |
| `search-repos` | Find a repository when the user only describes it |

Conversation history is persisted to a local SQLite file via `@mastra/memory` + LibSQL, so
multi-turn follow-ups ("and its issues?") work.

## Quick start

Requires Node.js 20.9+.

```bash
git clone <this-repo>
cd mastra-github-agent
npm install

cp .env.example .env
# add your ANTHROPIC_API_KEY
```

### Option 1 — the interactive playground

```bash
npm run dev
```

Opens Mastra Studio at <http://localhost:4111>. Pick **GitHub Repo Assistant**, chat with it,
and watch each tool call and its arguments/results in the trace panel. This is the best way
to demo it.

### Option 2 — the scripted demo

```bash
npm run demo
```

Runs a couple of canned questions and streams the answers to your terminal. Pass your own:

```bash
npm run demo -- "What are the newest open issues on vercel/ai?"
```

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `GITHUB_TOKEN` | no | Raises the GitHub rate limit from 60 to 5,000 requests/hour. Any token with public read access works. |

Without a `GITHUB_TOKEN` everything still runs — you just share the anonymous 60 req/hour
budget, which is fine for a demo but runs out quickly if you hammer it.

## Project layout

```
src/
  demo.ts                       # scripted CLI demo
  mastra/
    index.ts                    # Mastra instance — registers agents, storage, logger
    agents/github-agent.ts      # the agent: instructions + model + tools + memory
    tools/github.ts             # five typed GitHub tools (zod in, zod out)
```

## Extending it

Adding a capability is one `createTool` call plus one line in the `githubTools` export:

```ts
export const listContributorsTool = createTool({
  id: 'list-contributors',
  description: 'List the top contributors to a repository.',
  inputSchema: z.object({ owner: z.string(), repo: z.string() }),
  execute: async ({ owner, repo }) => github(`/repos/${owner}/${repo}/contributors`),
});
```

The description is what Claude reads to decide when to call it, so make it say *when* to use
the tool, not just what it does.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Mastra Studio playground with live tool traces |
| `npm run demo` | Run the agent from the CLI |
| `npm run build` | Build for deployment |
| `npm run typecheck` | `tsc --noEmit` |

## License

MIT
