import { z } from 'zod';

import type { ToolDescriptor } from '@ceo/contracts';
import { defineBusinessTool, type ToolRuntime } from '@ceo/platform-mastra';

/**
 * @ceo/integrations-finance — runway, burn, and cash position.
 *
 * Read-only, and the only integration whose *reads* are restricted to DM and
 * scheduled surfaces: cash position is not something the agent should recite into
 * a channel, however trusted, because channel membership changes without the
 * agent noticing.
 */

const DISABLED = {
  status: 'integration_disabled' as const,
  message:
    'The finance integration is not configured. Say the figures are unavailable — never estimate cash, burn, or runway.',
};

function enabled(): boolean {
  return Boolean(process.env.FINANCE_API_KEY);
}

const financeRead = (id: string, summary: string): ToolDescriptor => ({
  id,
  tier: 'tier0_read',
  summary,
  system: 'finance',
  reversible: true,
  // Deliberately excludes 'channel'.
  allowedSurfaces: ['dm', 'scheduled', 'admin_cli'],
});

export function financeTools(getRuntime: () => ToolRuntime) {
  const cashPosition = defineBusinessTool(
    {
      descriptor: financeRead('finance.cashPosition', 'Read cash position and runway'),
      description:
        'Read current cash, monthly burn, and implied runway. Use for board prep, hiring decisions, and any spend question.',
      inputSchema: z.object({ asOf: z.string().datetime().optional() }),
      renderSummary: a => `Read cash position${a.asOf ? ` as of ${a.asOf}` : ''}`,
      execute: async () => {
        if (!enabled()) return DISABLED;
        throw new Error('finance.cashPosition: no finance vendor bound (see ADR-0006)');
      },
    },
    getRuntime,
  );

  const spendByCategory = defineBusinessTool(
    {
      descriptor: financeRead('finance.spendByCategory', 'Read spend by category'),
      description:
        'Break spend down by category over a window, with variance against plan. Use when a cost question needs a specific driver.',
      inputSchema: z.object({
        from: z.string().datetime(),
        to: z.string().datetime(),
      }),
      renderSummary: a => `Read spend by category ${a.from}–${a.to}`,
      execute: async () => {
        if (!enabled()) return DISABLED;
        throw new Error('finance.spendByCategory: no finance vendor bound (see ADR-0006)');
      },
    },
    getRuntime,
  );

  return { cashPosition, spendByCategory };
}

export const FINANCE_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  financeRead('finance.cashPosition', 'Read cash position and runway'),
  financeRead('finance.spendByCategory', 'Read spend by category'),
];
