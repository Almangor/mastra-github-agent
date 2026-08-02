import { z } from 'zod';

import { type ToolDescriptor } from '@ceo/contracts';
import { defineBusinessTool, type ToolRuntime } from '@ceo/platform-mastra';

/**
 * @ceo/integrations-linear — delivery signal, plus the first genuinely gated write.
 *
 * `linear.createIssue` is tier-2: the agent may propose it freely, but the guard
 * turns it into an approval card before anything reaches Linear. This is the
 * integration to read first if you want to see the write path end to end.
 *
 * When `LINEAR_API_KEY` is absent the adapter runs in *degraded* mode: the tools
 * still exist, still enforce policy, and return clearly-labelled placeholder data.
 * That keeps the agent demonstrable without silently inventing business facts —
 * every degraded response says so in-band so the model reports it honestly.
 */

const LINEAR_API = 'https://api.linear.app/graphql';

function enabled(): boolean {
  return Boolean(process.env.LINEAR_API_KEY);
}

async function linear<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.LINEAR_API_KEY ?? '',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Linear GraphQL: ${body.errors.map(e => e.message).join('; ')}`);
  if (!body.data) throw new Error('Linear returned no data');
  return body.data;
}

const DEGRADED = {
  status: 'integration_disabled' as const,
  message:
    'The Linear integration has no API key configured. Report this to the user as missing data — do not substitute an estimate.',
};

export function linearTools(getRuntime: () => ToolRuntime) {
  const listIssues = defineBusinessTool(
    {
      descriptor: {
        id: 'linear.listIssues',
        tier: 'tier0_read',
        summary: 'Read Linear issues',
        system: 'linear',
        reversible: true,
        allowedSurfaces: ['dm', 'channel', 'scheduled', 'admin_cli'],
      },
      description:
        'List Linear issues, optionally filtered by team or state. Use to assess delivery status and in-flight work.',
      inputSchema: z.object({
        teamKey: z.string().optional().describe('Team key, e.g. "ENG"'),
        state: z.enum(['backlog', 'unstarted', 'started', 'completed', 'canceled']).optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
      renderSummary: a => `Read Linear issues${a.teamKey ? ` for ${a.teamKey}` : ''}`,
      execute: async ({ teamKey, state, limit }) => {
        if (!enabled()) return DEGRADED;
        const data = await linear<{ issues: { nodes: Record<string, any>[] } }>(
          `query Issues($first: Int!) {
             issues(first: $first) {
               nodes { identifier title state { name type } assignee { name } dueDate updatedAt url }
             }
           }`,
          { first: limit },
        );
        let nodes = data.issues.nodes;
        if (teamKey) nodes = nodes.filter(n => String(n.identifier).startsWith(`${teamKey}-`));
        if (state) nodes = nodes.filter(n => n.state?.type === state);
        return {
          count: nodes.length,
          issues: nodes.map(n => ({
            identifier: n.identifier,
            title: n.title,
            state: n.state?.name,
            assignee: n.assignee?.name ?? null,
            dueDate: n.dueDate ?? null,
            url: n.url,
          })),
        };
      },
    },
    getRuntime,
  );

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
      inputSchema: z.object({
        teamKey: z.string().describe('Team key, e.g. "ENG"'),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.number().int().min(0).max(4).default(3).describe('0 none … 1 urgent'),
      }),
      // Shown verbatim on the approval card, so it must describe the real effect.
      renderSummary: a => `Create Linear issue in ${a.teamKey}: "${a.title}" (priority ${a.priority})`,
      execute: async ({ teamKey, title, description, priority }) => {
        if (!enabled()) return DEGRADED;
        const teams = await linear<{ teams: { nodes: { id: string; key: string }[] } }>(
          'query { teams(first: 50) { nodes { id key } } }',
        );
        const team = teams.teams.nodes.find(t => t.key === teamKey);
        if (!team) throw new Error(`No Linear team with key "${teamKey}"`);

        const created = await linear<{ issueCreate: { success: boolean; issue: Record<string, any> } }>(
          `mutation Create($input: IssueCreateInput!) {
             issueCreate(input: $input) { success issue { identifier url title } }
           }`,
          { input: { teamId: team.id, title, description, priority } },
        );
        return { status: 'created', issue: created.issueCreate.issue };
      },
    },
    getRuntime,
  );

  return { listIssues, createIssue };
}

export const LINEAR_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    id: 'linear.listIssues',
    tier: 'tier0_read',
    summary: 'Read Linear issues',
    system: 'linear',
    reversible: true,
    allowedSurfaces: ['dm', 'channel', 'scheduled', 'admin_cli'],
  },
  {
    id: 'linear.createIssue',
    tier: 'tier2_business_write',
    summary: 'Create a Linear issue',
    system: 'linear',
    reversible: true,
    allowedSurfaces: ['dm', 'channel', 'scheduled'],
  },
];
