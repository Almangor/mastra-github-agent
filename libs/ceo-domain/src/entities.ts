import { z } from 'zod';

/**
 * Executive-state entities (plan: "Database entities").
 *
 * These are the nouns the CEO agent actually reasons about. They exist as durable
 * records rather than as text in a transcript, because the workflows in
 * @ceo/workflows need to answer questions like "which commitments are overdue"
 * without re-reading a conversation history.
 */

export const FunctionAreaSchema = z.enum([
  'strategy',
  'operations',
  'revenue',
  'finance',
  'product',
  'engineering',
  'people',
  'legal',
  'communications',
]);
export type FunctionArea = z.infer<typeof FunctionAreaSchema>;

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

/** Shared provenance block. Every claim the agent surfaces must be traceable. */
export const ProvenanceSchema = z
  .object({
    /** Where the fact came from: a tool id, a Slack permalink, a document URL. */
    source: z.string().min(1),
    /** The run that observed it, for replay and audit. */
    observedInRunId: z.string().min(1).optional(),
    observedAt: z.string().datetime(),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

// --- Decision ----------------------------------------------------------------

export const DecisionStatusSchema = z.enum(['open', 'decided', 'deferred', 'reversed']);

export const DecisionSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    title: z.string().min(1),
    /** The question in one sentence. Forces the memo to have a real subject. */
    question: z.string().min(1),
    area: FunctionAreaSchema,
    status: DecisionStatusSchema,
    options: z
      .array(
        z.object({
          label: z.string().min(1),
          pros: z.array(z.string()),
          cons: z.array(z.string()),
          /** Cost of being wrong. Drives how much analysis is warranted. */
          reversibility: z.enum(['reversible', 'costly', 'irreversible']),
        }),
      )
      .default([]),
    recommendation: z.string().optional(),
    decidedOption: z.string().optional(),
    decidedBy: z.string().optional(),
    decidedAt: z.string().datetime().optional(),
    /** What we expect to be true if this was right. Checked at the next review. */
    successCriteria: z.array(z.string()).default([]),
    provenance: z.array(ProvenanceSchema).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Decision = z.infer<typeof DecisionSchema>;

// --- Commitment --------------------------------------------------------------

export const CommitmentStatusSchema = z.enum(['open', 'in_progress', 'done', 'missed', 'dropped']);

export const CommitmentSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    /** Who owes it. A Slack user id where known, otherwise a free-text name. */
    owner: z.string().min(1),
    what: z.string().min(1),
    dueAt: z.string().datetime().optional(),
    status: CommitmentStatusSchema,
    area: FunctionAreaSchema,
    /** Where the commitment was made — a meeting, a thread, a decision. */
    sourceRef: z.string().min(1),
    provenance: ProvenanceSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Commitment = z.infer<typeof CommitmentSchema>;

// --- Risk --------------------------------------------------------------------

export const RiskSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    title: z.string().min(1),
    area: FunctionAreaSchema,
    likelihood: z.enum(['low', 'medium', 'high']),
    impact: z.enum(['low', 'medium', 'high', 'severe']),
    mitigation: z.string().optional(),
    owner: z.string().optional(),
    status: z.enum(['watching', 'active', 'mitigated', 'accepted', 'realised']),
    provenance: z.array(ProvenanceSchema).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Risk = z.infer<typeof RiskSchema>;

/** Ordering used by the delivery-risk review to decide what reaches the CEO. */
export function riskScore(risk: Pick<Risk, 'likelihood' | 'impact'>): number {
  const l = { low: 1, medium: 2, high: 3 }[risk.likelihood];
  const i = { low: 1, medium: 2, high: 3, severe: 5 }[risk.impact];
  return l * i;
}

// --- Brief -------------------------------------------------------------------

export const BriefItemSchema = z
  .object({
    headline: z.string().min(1),
    detail: z.string().min(1),
    area: FunctionAreaSchema,
    /** Why the CEO is being shown this rather than it being handled downstream. */
    whyItMatters: z.string().min(1),
    confidence: ConfidenceSchema,
    provenance: z.array(ProvenanceSchema).nonempty(),
    /** Explicit ask, if any. A brief item with no ask is FYI. */
    decisionNeeded: z.string().optional(),
  })
  .strict();
export type BriefItem = z.infer<typeof BriefItemSchema>;

export const BriefSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    kind: z.enum(['daily', 'weekly', 'incident', 'ad_hoc']),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    items: z.array(BriefItemSchema),
    /** Three lines maximum. The brief is read on a phone. */
    executiveSummary: z.string().min(1),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type Brief = z.infer<typeof BriefSchema>;

// --- Meeting -----------------------------------------------------------------

export const MeetingSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    title: z.string().min(1),
    startsAt: z.string().datetime(),
    attendees: z.array(z.string()),
    objective: z.string().optional(),
    /** Prepared beforehand by the meeting-prep workflow. */
    briefingPoints: z.array(z.string()).default([]),
    /** Extracted afterwards by the follow-up workflow. */
    decisionIds: z.array(z.string()).default([]),
    commitmentIds: z.array(z.string()).default([]),
  })
  .strict();
export type Meeting = z.infer<typeof MeetingSchema>;
