import { anthropic } from '@ai-sdk/anthropic';

import { type Env } from '@ceo/platform-config';

/**
 * Model routing (ADR-0004).
 *
 * Three roles, three cost/capability points:
 *   - supervisor: the CEO agent itself. Long-horizon, high stakes → Opus.
 *   - subagent:   focused specialist analysis with a narrow brief → Sonnet.
 *   - reviewer:   the learning reviewer. Proposal-only, runs on every turn → Sonnet.
 *
 * Routing lives here rather than inline in each agent so a model migration is one
 * file, and so the eval harness can pin models per run.
 */
export type ModelRole = 'supervisor' | 'subagent' | 'reviewer';

export function modelIdFor(env: Env, role: ModelRole): string {
  switch (role) {
    case 'supervisor':
      return env.CEO_SUPERVISOR_MODEL;
    case 'subagent':
      return env.CEO_SUBAGENT_MODEL;
    case 'reviewer':
      return env.CEO_REVIEWER_MODEL;
  }
}

export function modelFor(env: Env, role: ModelRole) {
  return anthropic(modelIdFor(env, role));
}
