import { z } from 'zod';

import type { RequestContext } from '@ceo/contracts';

/**
 * Workflow definitions (plan §2: "Workflows own repeatable CEO processes").
 *
 * A workflow is the canonical definition of a business process: an ordered list of
 * steps, some of which suspend for human input. It is deliberately framework-light
 * — no Inngest import, no Mastra import — so the same definition can be executed
 * inline during an eval, or durably by the worker, without changing.
 *
 * "Mastra workflows support persisted snapshots and suspension/resumption for human
 * input" — so suspension is a first-class outcome of a step, not an exception.
 */

export const StepOutcomeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('continue'), output: z.unknown() }).strict(),
  /** The step needs a human. The run is snapshotted and resumed on the answer. */
  z
    .object({
      type: z.literal('suspend'),
      reason: z.string().min(1),
      /** e.g. an approvalId, or a question to put to the CEO. */
      awaiting: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal('fail'), error: z.string().min(1) }).strict(),
  /** Nothing to do this run — a briefing with no material items, say. */
  z.object({ type: z.literal('skip'), reason: z.string().min(1) }).strict(),
]);
export type StepOutcome = z.infer<typeof StepOutcomeSchema>;

export interface WorkflowContext {
  request: RequestContext;
  /** Accumulated outputs of prior steps, keyed by step id. */
  state: Record<string, unknown>;
  now: Date;
}

export interface WorkflowStep {
  id: string;
  description: string;
  /** Whether this step may suspend. Used to plan durability requirements. */
  canSuspend: boolean;
  run: (ctx: WorkflowContext) => Promise<StepOutcome>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  /** Which specialists this process consults. Documented for the eval mapping. */
  consults: string[];
  steps: WorkflowStep[];
}

export type WorkflowRunStatus = 'completed' | 'suspended' | 'failed' | 'skipped';

export interface WorkflowRunResult {
  workflowId: string;
  status: WorkflowRunStatus;
  /** Step id the run stopped at, when suspended or failed. */
  stoppedAt?: string;
  state: Record<string, unknown>;
  /** Populated when suspended: what the run is waiting on. */
  awaiting?: string;
  error?: string;
  /** Ordered log of what happened, for the trace and the eval scorers. */
  trace: { stepId: string; outcome: StepOutcome['type']; detail?: string }[];
}

/**
 * Executes a workflow inline.
 *
 * Suspension stops the run and returns the accumulated state — the caller decides
 * whether to snapshot it (durable path) or fail the eval (test path). Resumption is
 * `runWorkflow` again with `resumeState` and the answered step's output injected,
 * which keeps replay identical to a fresh run.
 */
export async function runWorkflow(
  definition: WorkflowDefinition,
  context: { request: RequestContext; now?: Date; resumeState?: Record<string, unknown> },
): Promise<WorkflowRunResult> {
  const state: Record<string, unknown> = { ...(context.resumeState ?? {}) };
  const trace: WorkflowRunResult['trace'] = [];
  const now = context.now ?? new Date();

  for (const step of definition.steps) {
    // Resumed runs skip steps whose output is already present.
    if (step.id in state) {
      trace.push({ stepId: step.id, outcome: 'continue', detail: 'resumed from snapshot' });
      continue;
    }

    const outcome = await step.run({ request: context.request, state, now });

    switch (outcome.type) {
      case 'continue':
        state[step.id] = outcome.output;
        trace.push({ stepId: step.id, outcome: 'continue' });
        break;
      case 'skip':
        trace.push({ stepId: step.id, outcome: 'skip', detail: outcome.reason });
        return { workflowId: definition.id, status: 'skipped', stoppedAt: step.id, state, trace };
      case 'suspend':
        trace.push({ stepId: step.id, outcome: 'suspend', detail: outcome.reason });
        return {
          workflowId: definition.id,
          status: 'suspended',
          stoppedAt: step.id,
          awaiting: outcome.awaiting,
          state,
          trace,
        };
      case 'fail':
        trace.push({ stepId: step.id, outcome: 'fail', detail: outcome.error });
        return {
          workflowId: definition.id,
          status: 'failed',
          stoppedAt: step.id,
          error: outcome.error,
          state,
          trace,
        };
    }
  }

  return { workflowId: definition.id, status: 'completed', state, trace };
}

/** Convenience constructors that keep step definitions readable. */
export const step = {
  continue: (output: unknown): StepOutcome => ({ type: 'continue', output }),
  suspend: (reason: string, awaiting: string): StepOutcome => ({ type: 'suspend', reason, awaiting }),
  fail: (error: string): StepOutcome => ({ type: 'fail', error }),
  skip: (reason: string): StepOutcome => ({ type: 'skip', reason }),
};
