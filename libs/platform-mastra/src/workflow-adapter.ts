import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { RequestContextSchema, deriveMemoryResourceId, type RequestContext } from '@ceo/contracts';

/**
 * Adapts a framework-free workflow definition into a Mastra workflow.
 *
 * Plan §2 calls these "canonical business-process definitions" and puts them on
 * Mastra. The definitions in @ceo/workflows are deliberately framework-free so the
 * same object runs inline in an eval and durably in the worker — this adapter is
 * what makes the *third* surface work: visible and runnable in Mastra Studio,
 * with no second copy of the process to drift.
 *
 * The adapter is intentionally in `platform-mastra` rather than in `ceo-workflows`:
 * keeping the Mastra import out of the definitions is the whole reason they can be
 * evaluated without a runner.
 */

/** Structural mirror of `WorkflowDefinition`, so this package need not import it. */
export interface AdaptableStep {
  id: string;
  description: string;
  canSuspend: boolean;
  run: (ctx: {
    request: RequestContext;
    state: Record<string, unknown>;
    now: Date;
  }) => Promise<
    // `output` is optional because zod infers `z.unknown()` as optional; keeping
    // the mirror loose here avoids forcing a cast at the one place it is used.
    | { type: 'continue'; output?: unknown }
    | { type: 'suspend'; reason: string; awaiting: string }
    | { type: 'fail'; error: string }
    | { type: 'skip'; reason: string }
  >;
}

export interface AdaptableWorkflow {
  id: string;
  name: string;
  description: string;
  consults: string[];
  steps: AdaptableStep[];
}

/**
 * Input accepted from Studio. `workspaceId` is required because every executive
 * read is workspace-scoped; the rest is optional seed state so a process like
 * `decision-memo` can be exercised with its question supplied.
 */
const WorkflowInputSchema = z.object({
  workspaceId: z.string().min(1).describe('Workspace to run against, e.g. "T_ACME"'),
  input: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional seed state, e.g. { "question": "Should we open a US entity?" }'),
});

const StepOutputSchema = z.object({
  stepId: z.string(),
  outcome: z.enum(['continue', 'suspend', 'fail', 'skip']),
  detail: z.string().optional(),
  state: z.record(z.string(), z.unknown()),
});

/**
 * Builds the scheduled RequestContext a workflow runs under.
 *
 * Always the `system` role on the `scheduled` surface: a workflow triggered from
 * Studio must not inherit a human's authority, and `system` can approve nothing.
 */
function scheduledContext(workspaceId: string, now: Date): RequestContext {
  return RequestContextSchema.parse({
    requestId: `wf_${now.getTime()}`,
    workspaceId,
    userId: 'system',
    role: 'system',
    surface: 'scheduled',
    channelPolicy: 'trusted',
    isSlackConnect: false,
    memoryResourceId: deriveMemoryResourceId({ workspaceId, surface: 'scheduled', userId: 'system' }),
    receivedAt: now.toISOString(),
    isRedelivery: false,
  });
}

export function toMastraWorkflow(definition: AdaptableWorkflow) {
  // Each definition step becomes one Mastra step, so Studio shows the real shape
  // of the process — including which steps can suspend for a human.
  const steps = definition.steps.map((step, index) =>
    createStep({
      id: step.id,
      description: `${step.description}${step.canSuspend ? ' (may suspend for human input)' : ''}`,
      inputSchema: index === 0 ? WorkflowInputSchema : StepOutputSchema,
      outputSchema: StepOutputSchema,
      execute: async ({ inputData }: { inputData: unknown }) => {
        const now = new Date();

        const first = inputData as z.infer<typeof WorkflowInputSchema>;
        const carried = inputData as z.infer<typeof StepOutputSchema>;

        const state: Record<string, unknown> =
          index === 0 ? { ...(first.input ?? {}) } : { ...carried.state };
        const workspaceId =
          index === 0 ? first.workspaceId : String(state.__workspaceId ?? 'unknown');
        state.__workspaceId = workspaceId;

        // A step that already ran (resumed snapshot) is not re-executed, matching
        // `runWorkflow`'s replay semantics.
        if (step.id in state) {
          return { stepId: step.id, outcome: 'continue' as const, detail: 'resumed from snapshot', state };
        }

        const outcome = await step.run({
          request: scheduledContext(workspaceId, now),
          state,
          now,
        });

        switch (outcome.type) {
          case 'continue':
            state[step.id] = outcome.output;
            return { stepId: step.id, outcome: 'continue' as const, state };
          case 'skip':
            return { stepId: step.id, outcome: 'skip' as const, detail: outcome.reason, state };
          case 'suspend':
            // Surfaced as data rather than thrown: Studio shows what the process is
            // waiting on, and the durable worker decides whether to snapshot.
            return { stepId: step.id, outcome: 'suspend' as const, detail: `${outcome.reason} → awaiting ${outcome.awaiting}`, state };
          case 'fail':
            return { stepId: step.id, outcome: 'fail' as const, detail: outcome.error, state };
        }
      },
    }),
  );

  const workflow = createWorkflow({
    id: definition.id,
    description: `${definition.description}${definition.consults.length ? ` Consults: ${definition.consults.join(', ')}.` : ''}`,
    inputSchema: WorkflowInputSchema,
    outputSchema: StepOutputSchema,
  });

  let chained = workflow.then(steps[0]!);
  for (const step of steps.slice(1)) chained = chained.then(step) as typeof chained;
  chained.commit();

  return workflow;
}

/** Adapts every definition, keyed by id, ready to hand to `new Mastra({ workflows })`. */
export function toMastraWorkflows(definitions: AdaptableWorkflow[]): Record<string, unknown> {
  return Object.fromEntries(definitions.map(d => [d.id, toMastraWorkflow(d)]));
}
