import { z } from 'zod';

import type { ToolDescriptor } from '@ceo/contracts';
import { riskScore } from '@ceo/domain';
import type { MemoryStore } from '@ceo/memory';
import type { ExecutiveStore } from '@ceo/platform-db';
import { defineBusinessTool, type ToolRuntime } from '@ceo/platform-mastra';

/**
 * Tools over our own executive state and memory.
 *
 * These are tier-0 reads even though they touch a database, because the database
 * is ours: nothing here is visible outside the system. The workspace scoping is
 * taken from the runtime context rather than from an argument, so an agent cannot
 * read another tenant's decisions by asking nicely.
 */

export interface ExecutiveToolDeps {
  getRuntime: () => ToolRuntime;
  store: ExecutiveStore;
  memory: MemoryStore;
}

const internalRead = (id: string, summary: string): ToolDescriptor => ({
  id,
  tier: 'tier0_read',
  summary,
  system: 'executive-state',
  reversible: true,
  allowedSurfaces: ['dm', 'channel', 'scheduled', 'admin_cli'],
});

export function executiveTools(deps: ExecutiveToolDeps) {
  const { getRuntime, store, memory } = deps;

  const listDecisions = defineBusinessTool(
    {
      descriptor: internalRead('exec.listDecisions', 'Read recorded decisions'),
      description:
        'List decisions the company has recorded, optionally by status. Use before re-litigating something that was already decided.',
      inputSchema: z.object({
        status: z.enum(['open', 'decided', 'deferred', 'reversed']).optional(),
      }),
      renderSummary: a => `Read ${a.status ?? 'all'} decisions`,
      execute: async ({ status }, runtime) => {
        const page = await store.listDecisions(runtime.context.workspaceId, { status });
        return {
          count: page.total,
          decisions: page.items.map(d => ({
            id: d.id,
            title: d.title,
            question: d.question,
            status: d.status,
            area: d.area,
            decidedOption: d.decidedOption ?? null,
            decidedAt: d.decidedAt ?? null,
          })),
        };
      },
    },
    getRuntime,
  );

  const listCommitments = defineBusinessTool(
    {
      descriptor: internalRead('exec.listCommitments', 'Read tracked commitments'),
      description:
        'List commitments people have made, filterable by owner, status, or due date. Use to answer "what is overdue" and "who owes what".',
      inputSchema: z.object({
        owner: z.string().optional(),
        status: z.enum(['open', 'in_progress', 'done', 'missed', 'dropped']).optional(),
        dueBefore: z.string().datetime().optional(),
      }),
      renderSummary: a => `Read commitments${a.owner ? ` for ${a.owner}` : ''}`,
      execute: async (args, runtime) => {
        const page = await store.listCommitments(runtime.context.workspaceId, args);
        return {
          count: page.total,
          commitments: page.items.map(c => ({
            id: c.id,
            owner: c.owner,
            what: c.what,
            dueAt: c.dueAt ?? null,
            status: c.status,
            area: c.area,
            source: c.sourceRef,
          })),
        };
      },
    },
    getRuntime,
  );

  const listRisks = defineBusinessTool(
    {
      descriptor: internalRead('exec.listRisks', 'Read the risk register'),
      description:
        'List tracked risks, ranked by likelihood × impact. Use when asked what could go wrong or what needs watching.',
      inputSchema: z.object({
        status: z.enum(['watching', 'active', 'mitigated', 'accepted', 'realised']).optional(),
        limit: z.number().min(1).max(50).default(10),
      }),
      renderSummary: a => `Read ${a.status ?? 'all'} risks`,
      execute: async ({ status, limit }, runtime) => {
        const page = await store.listRisks(runtime.context.workspaceId, { status });
        const ranked = [...page.items]
          .sort((a, b) => riskScore(b) - riskScore(a))
          .slice(0, limit);
        return {
          count: ranked.length,
          risks: ranked.map(r => ({
            id: r.id,
            title: r.title,
            area: r.area,
            score: riskScore(r),
            likelihood: r.likelihood,
            impact: r.impact,
            owner: r.owner ?? null,
            status: r.status,
          })),
        };
      },
    },
    getRuntime,
  );

  const searchWorkspace = defineBusinessTool(
    {
      descriptor: internalRead('memory.searchWorkspace', 'Search shared workspace memory'),
      description:
        'Search durable workspace memory — business facts, prior context, organisational history. This never reaches another person\'s private conversations.',
      inputSchema: z.object({
        query: z.string().min(2).describe('What to look for'),
        limit: z.number().min(1).max(25).default(10),
      }),
      renderSummary: a => `Search workspace memory for "${a.query}"`,
      execute: async ({ query, limit }, runtime) => {
        const results = await memory.searchWorkspace(runtime.context, { contains: query, limit });
        return {
          count: results.length,
          entries: results.map(e => ({
            layer: e.layer,
            content: e.content,
            source: e.source ?? null,
            createdAt: e.createdAt,
          })),
        };
      },
    },
    getRuntime,
  );

  return { listDecisions, listCommitments, listRisks, searchWorkspace };
}
