/**
 * The single source of truth for the workspace layout (plan §5).
 * Imported by the scaffolder, the boundary checker, and the Nx tag generator so
 * the tree, the path aliases, and the dependency constraints can never drift.
 */
export type Layer = 'contracts' | 'domain' | 'platform' | 'integration' | 'core' | 'app';

export interface WorkspacePackage {
  /** Path from the repo root, e.g. "libs/ceo-policy". */
  dir: string;
  /** npm name and import specifier, e.g. "@ceo/policy". */
  name: string;
  /** Drives the dependency constraints enforced by check-boundaries.ts. */
  layer: Layer;
  desc: string;
}

export const PACKAGES: WorkspacePackage[] = [
  // ---- apps -------------------------------------------------------------
  { dir: 'apps/ceo-runtime', name: '@ceo/runtime', layer: 'app', desc: 'Slack control plane + Mastra agent runtime.' },
  { dir: 'apps/ceo-worker', name: '@ceo/worker', layer: 'app', desc: 'Inngest worker for durable, scheduled executive processes.' },
  { dir: 'apps/ceo-admin', name: '@ceo/admin', layer: 'app', desc: 'Operator CLI: approvals, skill curation, policy inspection.' },
  { dir: 'apps/ceo-evals', name: '@ceo/evals', layer: 'app', desc: 'Eval runner and release gates.' },

  // ---- core domain libs -------------------------------------------------
  { dir: 'libs/ceo-contracts', name: '@ceo/contracts', layer: 'contracts', desc: 'Zod contracts shared by every package. Depends on nothing.' },
  { dir: 'libs/ceo-domain', name: '@ceo/domain', layer: 'domain', desc: 'Executive domain entities and invariants.' },
  { dir: 'libs/ceo-policy', name: '@ceo/policy', layer: 'domain', desc: 'Authorization, tool-risk gating, approval enforcement.' },
  { dir: 'libs/ceo-agents', name: '@ceo/agents', layer: 'core', desc: 'CEO supervisor and specialist subagents.' },
  { dir: 'libs/ceo-workflows', name: '@ceo/workflows', layer: 'core', desc: 'Canonical executive business processes.' },
  { dir: 'libs/ceo-memory', name: '@ceo/memory', layer: 'core', desc: 'Six-layer memory architecture.' },
  { dir: 'libs/ceo-learning', name: '@ceo/learning', layer: 'core', desc: 'Governed self-learning state machine (proposal-only).' },
  { dir: 'libs/ceo-skills', name: '@ceo/skills', layer: 'core', desc: 'Versioned skills, lifecycle, curation.' },
  { dir: 'libs/ceo-eval-kit', name: '@ceo/eval-kit', layer: 'core', desc: 'Scorers, datasets, and hard release gates.' },

  // ---- integrations -----------------------------------------------------
  { dir: 'libs/integrations-slack', name: '@ceo/integrations-slack', layer: 'integration', desc: 'Slack control-plane adapter.' },
  { dir: 'libs/integrations-linear', name: '@ceo/integrations-linear', layer: 'integration', desc: 'Linear delivery adapter.' },
  { dir: 'libs/integrations-github', name: '@ceo/integrations-github', layer: 'integration', desc: 'GitHub engineering-signal adapter.' },
  { dir: 'libs/integrations-google', name: '@ceo/integrations-google', layer: 'integration', desc: 'Google Workspace calendar/docs adapter.' },
  { dir: 'libs/integrations-crm', name: '@ceo/integrations-crm', layer: 'integration', desc: 'CRM pipeline adapter.' },
  { dir: 'libs/integrations-finance', name: '@ceo/integrations-finance', layer: 'integration', desc: 'Finance/billing adapter.' },

  // ---- platform ---------------------------------------------------------
  { dir: 'libs/platform-mastra', name: '@ceo/platform-mastra', layer: 'platform', desc: 'Model routing, agent/tool factories, Mastra wiring.' },
  { dir: 'libs/platform-inngest', name: '@ceo/platform-inngest', layer: 'platform', desc: 'Durable execution boundary.' },
  { dir: 'libs/platform-db', name: '@ceo/platform-db', layer: 'platform', desc: 'Executive-state persistence.' },
  { dir: 'libs/platform-observability', name: '@ceo/platform-observability', layer: 'platform', desc: 'Structured logging, tracing, audit log.' },
  { dir: 'libs/platform-config', name: '@ceo/platform-config', layer: 'platform', desc: 'Validated environment configuration.' },
];
