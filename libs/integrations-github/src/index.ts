import { z } from 'zod';

import { type ToolDescriptor } from '@ceo/contracts';
import { defineBusinessTool, type ToolRuntime } from '@ceo/platform-mastra';

/**
 * @ceo/integrations-github — engineering signal for the product/engineering agent.
 *
 * Read-only by design. The CEO agent looks at delivery signal; it does not merge
 * pull requests. Adding a write tool here means adding a tier-2 descriptor and
 * accepting the approval gate that comes with it.
 */

const GITHUB_API = 'https://api.github.com';

async function github<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${GITHUB_API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ceo-agent',
  };
  // Optional: without a token we fall back to the anonymous 60 req/hour budget.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

const repoInput = z.object({
  owner: z.string().describe('Repository owner, e.g. "mastra-ai"'),
  repo: z.string().describe('Repository name, e.g. "mastra"'),
});

const readDescriptor = (id: string, summary: string): ToolDescriptor => ({
  id,
  tier: 'tier0_read',
  summary,
  system: 'github',
  reversible: true,
  allowedSurfaces: ['dm', 'channel', 'scheduled', 'admin_cli'],
});

export function githubTools(getRuntime: () => ToolRuntime) {
  const repoOverview = defineBusinessTool(
    {
      descriptor: readDescriptor('github.repoOverview', 'Read GitHub repository overview'),
      description:
        'Get overview information about a GitHub repository: description, stars, forks, primary language, open issue count. Use when assessing an external dependency or an open-source project.',
      inputSchema: repoInput,
      renderSummary: a => `Read GitHub repo ${a.owner}/${a.repo}`,
      execute: async ({ owner, repo }) => {
        const data = await github<Record<string, any>>(`/repos/${owner}/${repo}`);
        return {
          fullName: data.full_name,
          description: data.description,
          stars: data.stargazers_count,
          forks: data.forks_count,
          openIssues: data.open_issues_count,
          language: data.language,
          license: data.license?.spdx_id ?? null,
          pushedAt: data.pushed_at,
        };
      },
    },
    getRuntime,
  );

  const recentCommits = defineBusinessTool(
    {
      descriptor: readDescriptor('github.recentCommits', 'Read recent GitHub commits'),
      description:
        'List recent commits on a repository branch. Use to judge delivery velocity and what engineering has actually shipped.',
      inputSchema: repoInput.extend({
        branch: z.string().optional().describe('Branch; defaults to the repo default'),
        limit: z.number().min(1).max(30).default(10),
      }),
      renderSummary: a => `Read last ${a.limit} commits on ${a.owner}/${a.repo}`,
      execute: async ({ owner, repo, branch, limit }) => {
        const data = await github<Record<string, any>[]>(`/repos/${owner}/${repo}/commits`, {
          per_page: limit,
          ...(branch ? { sha: branch } : {}),
        });
        return {
          commits: data.map(c => ({
            sha: String(c.sha).slice(0, 7),
            message: String(c.commit.message).split('\n')[0],
            author: c.author?.login ?? c.commit.author?.name ?? null,
            date: c.commit.author?.date ?? null,
            url: c.html_url,
          })),
        };
      },
    },
    getRuntime,
  );

  const openIssues = defineBusinessTool(
    {
      descriptor: readDescriptor('github.openIssues', 'Read open GitHub issues'),
      description:
        'List issues on a repository, optionally filtered by label. Pull requests are excluded. Use to see what is unresolved.',
      inputSchema: repoInput.extend({
        state: z.enum(['open', 'closed', 'all']).default('open'),
        labels: z.string().optional().describe('Comma-separated labels, e.g. "bug,p0"'),
        limit: z.number().min(1).max(30).default(10),
      }),
      renderSummary: a => `Read ${a.state} issues on ${a.owner}/${a.repo}`,
      execute: async ({ owner, repo, state, labels, limit }) => {
        // The issues endpoint mixes PRs into results, so over-fetch then trim —
        // otherwise a page of pure PRs filters down to an empty, misleading answer.
        const data = await github<Record<string, any>[]>(`/repos/${owner}/${repo}/issues`, {
          state,
          per_page: Math.min(100, limit * 4),
          ...(labels ? { labels } : {}),
        });
        const issues = data
          .filter(i => !i.pull_request)
          .slice(0, limit)
          .map(i => ({
            number: i.number,
            title: i.title,
            state: i.state,
            labels: (i.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)),
            comments: i.comments,
            createdAt: i.created_at,
            url: i.html_url,
          }));
        return { count: issues.length, issues };
      },
    },
    getRuntime,
  );

  return { repoOverview, recentCommits, openIssues };
}

export const GITHUB_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  readDescriptor('github.repoOverview', 'Read GitHub repository overview'),
  readDescriptor('github.recentCommits', 'Read recent GitHub commits'),
  readDescriptor('github.openIssues', 'Read open GitHub issues'),
];
