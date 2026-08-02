import { z } from 'zod';

/**
 * @ceo/platform-inngest — the durable-execution boundary (plan §2).
 *
 * The plan draws a sharp line that this package exists to keep visible:
 *
 *   Inngest              → scheduled, durable, multi-minute, restart-safe processes
 *   Mastra workflows     → canonical business-process definitions
 *   Mastra background    → temporary within-turn research or subagent fan-out
 *
 * So the workflow *definition* lives in @ceo/workflows and knows nothing about
 * Inngest; this package only describes when and how it is triggered. That keeps a
 * business process testable without a durable runner, and lets the runner change.
 */

export const CronScheduleSchema = z
  .object({
    /** Standard 5-field cron. */
    expression: z.string().min(1),
    /** IANA timezone. Executive schedules are wall-clock, not UTC. */
    timezone: z.string().min(1),
  })
  .strict();
export type CronSchedule = z.infer<typeof CronScheduleSchema>;

export const DurableJobSchema = z
  .object({
    /** Stable id, also the Inngest function id. */
    id: z.string().min(1),
    /** The @ceo/workflows workflow this job runs. */
    workflowId: z.string().min(1),
    description: z.string().min(1),
    schedule: CronScheduleSchema.optional(),
    /** Event name that can also trigger it on demand. */
    eventName: z.string().min(1).optional(),
    /**
     * Concurrency key. Two daily briefings for the same workspace must never run
     * at once, or the CEO gets two different briefs from the same window.
     */
    concurrencyKey: z.string().min(1),
    /** Retries before the job is parked for an operator. */
    maxAttempts: z.number().int().min(1).max(10).default(3),
    /** Wall-clock ceiling; exceeded runs are cancelled, not left hanging. */
    timeoutMs: z.number().int().min(1000).default(15 * 60 * 1000),
  })
  .strict()
  .superRefine((job, issue) => {
    if (!job.schedule && !job.eventName) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a durable job needs a schedule, an event trigger, or both',
      });
    }
  });
export type DurableJob = z.infer<typeof DurableJobSchema>;

/**
 * The registry of durable jobs, matching the executive processes in §2 that are
 * genuinely scheduled. Processes that only ever run inside a turn (decision memo,
 * meeting prep on request) are deliberately absent — they are Mastra workflows
 * invoked directly, not durable jobs.
 */
export const DURABLE_JOBS: DurableJob[] = [
  DurableJobSchema.parse({
    id: 'daily-executive-briefing',
    workflowId: 'daily-briefing',
    description: 'Assemble and deliver the morning executive brief.',
    schedule: { expression: '30 6 * * 1-5', timezone: 'Europe/Riga' },
    eventName: 'ceo/briefing.requested',
    concurrencyKey: 'workspace',
    maxAttempts: 3,
  }),
  DurableJobSchema.parse({
    id: 'weekly-operating-review',
    workflowId: 'weekly-operating-review',
    description: 'Compile the weekly operating review across all functions.',
    schedule: { expression: '0 16 * * 5', timezone: 'Europe/Riga' },
    eventName: 'ceo/operating-review.requested',
    concurrencyKey: 'workspace',
    timeoutMs: 30 * 60 * 1000,
  }),
  DurableJobSchema.parse({
    id: 'commitment-tracking',
    workflowId: 'commitment-tracking',
    description: 'Chase commitments approaching or past their due date.',
    schedule: { expression: '0 9 * * 1-5', timezone: 'Europe/Riga' },
    concurrencyKey: 'workspace',
  }),
  DurableJobSchema.parse({
    id: 'delivery-risk-review',
    workflowId: 'delivery-risk-review',
    description: 'Surface delivery risks that crossed the escalation threshold.',
    schedule: { expression: '0 10 * * 2', timezone: 'Europe/Riga' },
    concurrencyKey: 'workspace',
  }),
  DurableJobSchema.parse({
    id: 'revenue-gtm-review',
    workflowId: 'revenue-gtm-review',
    description: 'Pipeline, conversion and forecast movement since last review.',
    schedule: { expression: '0 14 * * 1', timezone: 'Europe/Riga' },
    concurrencyKey: 'workspace',
  }),
  DurableJobSchema.parse({
    id: 'learning-review',
    workflowId: 'learning-review',
    description: 'Post-run review that may propose (never publish) memory and skills.',
    schedule: { expression: '0 2 * * *', timezone: 'Europe/Riga' },
    eventName: 'ceo/learning.review-requested',
    concurrencyKey: 'workspace',
  }),
  DurableJobSchema.parse({
    id: 'skill-curation',
    workflowId: 'skill-curation',
    description: 'Age unused skills through stale → archived and report usage.',
    schedule: { expression: '0 3 * * 0', timezone: 'Europe/Riga' },
    concurrencyKey: 'workspace',
  }),
];

/**
 * Where a given process belongs. Encoding the plan's boundary as a function keeps
 * the decision reviewable instead of ad hoc.
 */
export function executionSurfaceFor(input: {
  scheduled: boolean;
  expectedDurationMs: number;
  needsRestartSafety: boolean;
}): 'inngest' | 'mastra-workflow' | 'mastra-background-task' {
  if (input.scheduled || input.needsRestartSafety || input.expectedDurationMs > 60_000) {
    return 'inngest';
  }
  if (input.expectedDurationMs > 5_000) return 'mastra-workflow';
  return 'mastra-background-task';
}
