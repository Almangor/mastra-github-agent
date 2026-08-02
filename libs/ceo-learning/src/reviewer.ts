import { z } from 'zod';

import type { RiskTier } from '@ceo/contracts';

/**
 * The learning reviewer's authority envelope (plan §3).
 *
 * "The learning reviewer receives trace summaries and feedback but has
 * proposal-only authority. It cannot access business write tools, modify core
 * prompts, publish skills, or write directly into production."
 *
 * Rather than trusting a system prompt to hold that line, the constraint is
 * expressed as: (a) an allowlist of tiers it may see, (b) an explicit list of
 * protected artefacts, and (c) an output type whose only possible values are
 * proposals. The reviewer literally cannot express "publish this".
 */

/** The reviewer may only ever see read-tier tools. Enforced by `reviewerToolFilter`. */
export const REVIEWER_MAX_TIER: RiskTier = 'tier0_read';

/** Core artefacts the learning process may never target. */
export const PROTECTED_ARTEFACTS = [
  'system-prompt:supervisor',
  'system-prompt:specialist',
  'policy:access',
  'policy:tool-risk',
  'contract:approval',
] as const;
export type ProtectedArtefact = (typeof PROTECTED_ARTEFACTS)[number];

/**
 * Filters a tool set down to what the reviewer may hold.
 * Anything above tier-0 is dropped, not denied at call time — the reviewer never
 * even sees that a write tool exists.
 */
export function reviewerToolFilter<T extends { tier: RiskTier }>(tools: T[]): T[] {
  return tools.filter(t => t.tier === REVIEWER_MAX_TIER);
}

/** What the reviewer is given: summaries, never raw business data. */
export const TraceSummarySchema = z
  .object({
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    /** What the user was trying to achieve. */
    intent: z.string().min(1),
    /** Tool ids used, in order. No arguments — those may contain PII. */
    toolSequence: z.array(z.string()),
    outcome: z.enum(['succeeded', 'partially_succeeded', 'failed', 'abandoned']),
    /** Explicit user feedback, if any. The strongest learning signal. */
    userFeedback: z.string().optional(),
    /** Did a human correct the agent mid-run? */
    wasCorrected: z.boolean(),
    durationMs: z.number().int().min(0),
  })
  .strict();
export type TraceSummary = z.infer<typeof TraceSummarySchema>;

/**
 * The reviewer's *entire* output vocabulary. There is no "publish", no "activate",
 * no "modify prompt" variant — the type system is the first line of enforcement.
 */
export const ProposalSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('memory'),
      layer: z.enum(['semantic', 'profile', 'organisational']),
      content: z.string().min(1),
      source: z.string().min(1),
      rationale: z.string().min(1),
      evidenceRunIds: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('skill'),
      skillId: z.string().min(1),
      title: z.string().min(1),
      whenToUse: z.string().min(1),
      body: z.string().min(1),
      scope: z.enum(['supervisor', 'specialist', 'workflow']),
      target: z.string().optional(),
      rationale: z.string().min(1),
      evidenceRunIds: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('skill_patch'),
      skillId: z.string().min(1),
      /** Patches always create a new version; nothing is edited in place. */
      basedOnVersion: z.number().int().min(1),
      body: z.string().min(1),
      rationale: z.string().min(1),
      evidenceRunIds: z.array(z.string()).min(1),
    })
    .strict(),
]);
export type Proposal = z.infer<typeof ProposalSchema>;

export class ProtectedArtefactError extends Error {
  constructor(artefact: string) {
    super(`the learning process may not target the protected artefact "${artefact}"`);
    this.name = 'ProtectedArtefactError';
  }
}

/**
 * Final admissibility check on a proposal before it is recorded.
 *
 * Belt and braces over the schema: catches a proposal that is structurally valid
 * but semantically aimed at something protected.
 */
export function assertProposalAdmissible(proposal: Proposal): void {
  const targeted =
    proposal.kind === 'skill' ? `${proposal.scope}:${proposal.target ?? ''}` : undefined;

  for (const artefact of PROTECTED_ARTEFACTS) {
    const haystack = JSON.stringify(proposal).toLowerCase();
    if (haystack.includes(artefact.toLowerCase())) throw new ProtectedArtefactError(artefact);
  }
  if (targeted && PROTECTED_ARTEFACTS.includes(targeted as ProtectedArtefact)) {
    throw new ProtectedArtefactError(targeted);
  }
}

/**
 * Whether a run is even worth reviewing.
 *
 * Reviewing every run produces noise and cost; the signal is concentrated in runs
 * that were corrected, that failed, or that carried explicit feedback.
 */
export function isWorthReviewing(summary: TraceSummary): boolean {
  if (summary.wasCorrected) return true;
  if (summary.userFeedback) return true;
  if (summary.outcome === 'failed' || summary.outcome === 'partially_succeeded') return true;
  // A long successful run is worth capturing as a procedure.
  return summary.outcome === 'succeeded' && summary.toolSequence.length >= 5;
}
