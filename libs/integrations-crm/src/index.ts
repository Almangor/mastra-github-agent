import { z } from 'zod';

import type { ToolDescriptor } from '@ceo/contracts';
import { defineBusinessTool, type ToolRuntime } from '@ceo/platform-mastra';

/**
 * @ceo/integrations-crm — pipeline and revenue signal for the revenue agent.
 *
 * Read-only. The CEO agent reads the pipeline; it does not edit opportunity records,
 * because a wrong close-date edit propagates into the forecast that the same agent
 * later reports on. Reads and writes to the same system by the same agent is a loop
 * we deliberately do not close.
 */

const DISABLED = {
  status: 'integration_disabled' as const,
  message:
    'The CRM integration is not configured. Report pipeline figures as unavailable — never estimate revenue numbers.',
};

function enabled(): boolean {
  return Boolean(process.env.CRM_API_KEY);
}

export function crmTools(getRuntime: () => ToolRuntime) {
  const readDescriptor = (id: string, summary: string): ToolDescriptor => ({
    id,
    tier: 'tier0_read',
    summary,
    system: 'crm',
    reversible: true,
    allowedSurfaces: ['dm', 'scheduled', 'admin_cli'],
  });

  const pipelineSummary = defineBusinessTool(
    {
      descriptor: readDescriptor('crm.pipelineSummary', 'Read pipeline summary'),
      description:
        'Summarise the sales pipeline by stage: count, value, and movement since a prior date. Use for revenue reviews and forecast questions.',
      inputSchema: z.object({
        since: z.string().datetime().describe('Compare against this point in time'),
        segment: z.string().optional().describe('Optional segment filter, e.g. "enterprise"'),
      }),
      renderSummary: a => `Read CRM pipeline since ${a.since}${a.segment ? ` (${a.segment})` : ''}`,
      execute: async () => {
        if (!enabled()) return DISABLED;
        throw new Error('crm.pipelineSummary: no CRM vendor bound (see ADR-0006)');
      },
    },
    getRuntime,
  );

  const atRiskDeals = defineBusinessTool(
    {
      descriptor: readDescriptor('crm.atRiskDeals', 'Read at-risk deals'),
      description:
        'List deals that have slipped, gone quiet, or lost their champion. Use when the CEO asks what could miss the quarter.',
      inputSchema: z.object({ limit: z.number().min(1).max(50).default(10) }),
      renderSummary: a => `Read top ${a.limit} at-risk deals`,
      execute: async () => {
        if (!enabled()) return DISABLED;
        throw new Error('crm.atRiskDeals: no CRM vendor bound (see ADR-0006)');
      },
    },
    getRuntime,
  );

  return { pipelineSummary, atRiskDeals };
}

export const CRM_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    id: 'crm.pipelineSummary',
    tier: 'tier0_read',
    summary: 'Read pipeline summary',
    system: 'crm',
    reversible: true,
    allowedSurfaces: ['dm', 'scheduled', 'admin_cli'],
  },
  {
    id: 'crm.atRiskDeals',
    tier: 'tier0_read',
    summary: 'Read at-risk deals',
    system: 'crm',
    reversible: true,
    allowedSurfaces: ['dm', 'scheduled', 'admin_cli'],
  },
];
