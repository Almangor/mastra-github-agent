import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const GITHUB_API = 'https://api.github.com';

/**
 * Calls the GitHub REST API. A token is optional — without one you get the
 * anonymous rate limit (60 requests/hour), which is plenty for a demo.
 */
async function github<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${GITHUB_API}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mastra-github-agent',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

const repoInput = z.object({
  owner: z.string().describe('Repository owner, e.g. "mastra-ai"'),
  repo: z.string().describe('Repository name, e.g. "mastra"'),
});

export const getRepoTool = createTool({
  id: 'get-repo',
  description:
    'Get overview information about a GitHub repository: description, stars, forks, primary language, license, topics, and open issue count.',
  inputSchema: repoInput,
  outputSchema: z.object({
    fullName: z.string(),
    description: z.string().nullable(),
    homepage: z.string().nullable(),
    stars: z.number(),
    forks: z.number(),
    openIssues: z.number(),
    language: z.string().nullable(),
    license: z.string().nullable(),
    topics: z.array(z.string()),
    createdAt: z.string(),
    pushedAt: z.string(),
  }),
  execute: async ({ owner, repo }) => {
    const data = await github<any>(`/repos/${owner}/${repo}`);
    return {
      fullName: data.full_name,
      description: data.description,
      homepage: data.homepage,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      language: data.language,
      license: data.license?.spdx_id ?? null,
      topics: data.topics ?? [],
      createdAt: data.created_at,
      pushedAt: data.pushed_at,
    };
  },
});

export const listIssuesTool = createTool({
  id: 'list-issues',
  description:
    'List issues for a GitHub repository. Use this to answer questions about what people are reporting, what is being worked on, or what is unresolved. Pull requests are excluded.',
  inputSchema: repoInput.extend({
    state: z.enum(['open', 'closed', 'all']).default('open').describe('Which issues to return'),
    labels: z.string().optional().describe('Comma-separated label names to filter by, e.g. "bug,help wanted"'),
    limit: z.number().min(1).max(30).default(10).describe('How many issues to return'),
  }),
  outputSchema: z.object({
    count: z.number(),
    issues: z.array(
      z.object({
        number: z.number(),
        title: z.string(),
        state: z.string(),
        labels: z.array(z.string()),
        comments: z.number(),
        author: z.string().nullable(),
        createdAt: z.string(),
        url: z.string(),
      }),
    ),
  }),
  execute: async ({ owner, repo, state, labels, limit }) => {
    // The issues endpoint mixes pull requests into the results, so a page of
    // `limit` items can be all PRs and filter down to nothing. Over-fetch, then trim.
    const data = await github<any[]>(`/repos/${owner}/${repo}/issues`, {
      state,
      per_page: Math.min(100, limit * 4),
      ...(labels ? { labels } : {}),
    });

    const issues = data
      .filter(item => !item.pull_request)
      .slice(0, limit)
      .map(item => ({
        number: item.number,
        title: item.title,
        state: item.state,
        labels: (item.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)),
        comments: item.comments,
        author: item.user?.login ?? null,
        createdAt: item.created_at,
        url: item.html_url,
      }));

    return { count: issues.length, issues };
  },
});

export const listReleasesTool = createTool({
  id: 'list-releases',
  description:
    'List recent releases for a GitHub repository, including the release notes body. Use this to answer "what changed recently" or "what is in the latest version".',
  inputSchema: repoInput.extend({
    limit: z.number().min(1).max(10).default(5).describe('How many releases to return'),
  }),
  outputSchema: z.object({
    releases: z.array(
      z.object({
        name: z.string().nullable(),
        tag: z.string(),
        publishedAt: z.string().nullable(),
        // Release bodies can be enormous; trimmed so they don't flood the context.
        notes: z.string(),
        url: z.string(),
      }),
    ),
  }),
  execute: async ({ owner, repo, limit }) => {
    const data = await github<any[]>(`/repos/${owner}/${repo}/releases`, { per_page: limit });
    return {
      releases: data.map(release => ({
        name: release.name,
        tag: release.tag_name,
        publishedAt: release.published_at,
        notes: (release.body ?? '').slice(0, 2000),
        url: release.html_url,
      })),
    };
  },
});

export const listCommitsTool = createTool({
  id: 'list-commits',
  description:
    'List the most recent commits on a GitHub repository branch. Use this to summarise what work has landed lately.',
  inputSchema: repoInput.extend({
    branch: z.string().optional().describe('Branch name; defaults to the repository default branch'),
    limit: z.number().min(1).max(30).default(10).describe('How many commits to return'),
  }),
  outputSchema: z.object({
    commits: z.array(
      z.object({
        sha: z.string(),
        message: z.string(),
        author: z.string().nullable(),
        date: z.string().nullable(),
        url: z.string(),
      }),
    ),
  }),
  execute: async ({ owner, repo, branch, limit }) => {
    const data = await github<any[]>(`/repos/${owner}/${repo}/commits`, {
      per_page: limit,
      ...(branch ? { sha: branch } : {}),
    });
    return {
      commits: data.map(commit => ({
        sha: commit.sha.slice(0, 7),
        message: commit.commit.message.split('\n')[0],
        author: commit.author?.login ?? commit.commit.author?.name ?? null,
        date: commit.commit.author?.date ?? null,
        url: commit.html_url,
      })),
    };
  },
});

export const searchReposTool = createTool({
  id: 'search-repos',
  description:
    'Search GitHub for repositories matching a query. Use this when the user describes a project instead of naming owner/repo, so you can find the right repository first.',
  inputSchema: z.object({
    query: z.string().describe('GitHub search query, e.g. "typescript agent framework stars:>1000"'),
    limit: z.number().min(1).max(10).default(5).describe('How many results to return'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        fullName: z.string(),
        description: z.string().nullable(),
        stars: z.number(),
        language: z.string().nullable(),
        url: z.string(),
      }),
    ),
  }),
  execute: async ({ query, limit }) => {
    const data = await github<{ items: any[] }>('/search/repositories', {
      q: query,
      per_page: limit,
      sort: 'stars',
    });
    return {
      results: data.items.map(item => ({
        fullName: item.full_name,
        description: item.description,
        stars: item.stargazers_count,
        language: item.language,
        url: item.html_url,
      })),
    };
  },
});

export const githubTools = {
  getRepoTool,
  listIssuesTool,
  listReleasesTool,
  listCommitsTool,
  searchReposTool,
};
