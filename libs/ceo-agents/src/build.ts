import { Agent } from '@mastra/core/agent';

import type { ToolDescriptor } from '@ceo/contracts';
import type { MemoryStore } from '@ceo/memory';
import type { Env } from '@ceo/platform-config';
import type { ExecutiveStore } from '@ceo/platform-db';
import { descriptorOf, modelFor, type ToolRuntime } from '@ceo/platform-mastra';
import { crmTools } from '@ceo/integrations-crm';
import { financeTools } from '@ceo/integrations-finance';
import { githubTools } from '@ceo/integrations-github';
import { linearTools } from '@ceo/integrations-linear';

import { SPECIALISTS, SUPERVISOR_INSTRUCTIONS, type AgentSpec, BASE_INSTRUCTIONS } from './roster.ts';
import { executiveTools } from './executive-tools.ts';

/**
 * Agent construction and the tool-boundary enforcement that goes with it.
 *
 * Two independent checks run here, at build time rather than at call time:
 *   1. A specialist only receives tools its roster entry lists.
 *   2. A specialist never receives a tool above its declared `maxTier`.
 *
 * Doing this at construction means a mis-scoped agent fails to build rather than
 * failing at 3am when the model happens to reach for something it should not have.
 */

export interface BuildContext {
  env: Env;
  getRuntime: () => ToolRuntime;
  store: ExecutiveStore;
  memory: MemoryStore;
}

type ToolMap = Record<string, unknown>;

/** Assembles every guarded tool, keyed by its descriptor id. */
export function buildToolCatalogue(ctx: BuildContext): {
  tools: ToolMap;
  descriptors: Map<string, ToolDescriptor>;
} {
  const { getRuntime } = ctx;

  const github = githubTools(getRuntime);
  const linear = linearTools(getRuntime);
  const crm = crmTools(getRuntime);
  const finance = financeTools(getRuntime);
  const exec = executiveTools({ getRuntime, store: ctx.store, memory: ctx.memory });

  const tools: ToolMap = {
    'github.repoOverview': github.repoOverview,
    'github.recentCommits': github.recentCommits,
    'github.openIssues': github.openIssues,
    'linear.listIssues': linear.listIssues,
    'linear.createIssue': linear.createIssue,
    'crm.pipelineSummary': crm.pipelineSummary,
    'crm.atRiskDeals': crm.atRiskDeals,
    'finance.cashPosition': finance.cashPosition,
    'finance.spendByCategory': finance.spendByCategory,
    'exec.listDecisions': exec.listDecisions,
    'exec.listCommitments': exec.listCommitments,
    'exec.listRisks': exec.listRisks,
    'memory.searchWorkspace': exec.searchWorkspace,
  };

  const descriptors = new Map<string, ToolDescriptor>();
  for (const [id, tool] of Object.entries(tools)) {
    const descriptor = descriptorOf(tool);
    if (descriptor) descriptors.set(id, descriptor);
  }

  return { tools, descriptors };
}

export class ToolBoundaryViolation extends Error {
  constructor(agentId: string, toolId: string, detail: string) {
    super(`agent "${agentId}" may not hold tool "${toolId}": ${detail}`);
    this.name = 'ToolBoundaryViolation';
  }
}

/**
 * Selects an agent's tools and enforces its boundary.
 *
 * `descriptors` is optional because the tier ceiling can only be checked when a
 * descriptor is available; when it is, an over-tier tool is a hard build failure.
 */
export function selectTools(
  spec: AgentSpec,
  catalogue: ToolMap,
  descriptors?: Map<string, ToolDescriptor>,
): ToolMap {
  const TIER_ORDER = ['tier0_read', 'tier1_internal_write', 'tier2_business_write', 'tier3_critical'];
  const selected: ToolMap = {};

  for (const toolId of spec.tools) {
    const tool = catalogue[toolId];
    if (!tool) throw new ToolBoundaryViolation(spec.id, toolId, 'no such tool in the catalogue');

    const descriptor = descriptors?.get(toolId);
    if (descriptor && TIER_ORDER.indexOf(descriptor.tier) > TIER_ORDER.indexOf(spec.maxTier)) {
      throw new ToolBoundaryViolation(
        spec.id,
        toolId,
        `tool is ${descriptor.tier} but the agent's ceiling is ${spec.maxTier}`,
      );
    }
    selected[toolId] = tool;
  }
  return selected;
}

export function buildSpecialist(spec: AgentSpec, ctx: BuildContext, catalogue: ToolMap, descriptors?: Map<string, ToolDescriptor>) {
  return new Agent({
    id: spec.id,
    name: `${spec.name} Agent`,
    instructions: `${BASE_INSTRUCTIONS}\n\nYour mandate: ${spec.mandate}\n\n${spec.instructions}`,
    model: modelFor(ctx.env, 'subagent'),
    tools: selectTools(spec, catalogue, descriptors) as never,
  });
}

/**
 * The CEO supervisor.
 *
 * It holds the full read catalogue plus the gated write tools, because it is the
 * agent that talks to a human who can approve them. Specialists are exposed to it
 * as sub-agents rather than as tools so their tool boundaries stay intact.
 */
export function buildSupervisor(ctx: BuildContext, catalogue: ToolMap) {
  return new Agent({
    id: 'ceoAgent',
    name: 'CEO Supervisor',
    instructions: SUPERVISOR_INSTRUCTIONS,
    model: modelFor(ctx.env, 'supervisor'),
    tools: catalogue as never,
  });
}

export function buildAllAgents(ctx: BuildContext) {
  const { tools, descriptors } = buildToolCatalogue(ctx);

  const specialists = Object.fromEntries(
    SPECIALISTS.map(spec => [spec.id, buildSpecialist(spec, ctx, tools, descriptors)]),
  );

  return {
    ceoAgent: buildSupervisor(ctx, tools),
    ...specialists,
  };
}
