import { z } from 'zod';

/**
 * Explainable user-model claims (plan: "Explainable user-model claims").
 *
 * A profile that says "prefers concise updates" is unfalsifiable and unfixable —
 * the CEO cannot tell whether it came from something they said once or from a
 * pattern across fifty turns, and they cannot correct it without arguing with a
 * black box.
 *
 * So every profile claim carries: the evidence it rests on, a confidence derived
 * from that evidence rather than asserted, and an explicit contradiction path.
 */

export const ClaimStatusSchema = z.enum([
  /** Held and in use. */
  'active',
  /** Contradicted by newer evidence; retained so the same claim is not re-learned. */
  'retracted',
  /** The user corrected it directly. Strongest possible signal. */
  'corrected',
]);

export const ClaimEvidenceSchema = z
  .object({
    /** What was observed, in one line. */
    observation: z.string().min(1),
    /** Where: a Slack permalink, a run id, a document. */
    source: z.string().min(1),
    observedAt: z.string().datetime(),
    /** True when the user stated it outright rather than it being inferred. */
    explicit: z.boolean(),
  })
  .strict();
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>;

export const UserClaimSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    subjectUserId: z.string().min(1),
    /** e.g. "communication.brevity", "delegation.style", "risk.appetite". */
    dimension: z.string().min(1),
    claim: z.string().min(1),
    status: ClaimStatusSchema,
    evidence: z.array(ClaimEvidenceSchema).min(1, 'a claim without evidence is a guess'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    /** Set when retracted, so we can explain *why* the agent changed its mind. */
    retractedReason: z.string().optional(),
  })
  .strict();
export type UserClaim = z.infer<typeof UserClaimSchema>;

/**
 * Confidence is computed, never asserted.
 *
 * One explicit statement outweighs several inferences: the user telling us
 * something is qualitatively better evidence than us noticing a pattern. Recency
 * matters too — a preference from a year ago is weak evidence about today.
 */
export function claimConfidence(claim: UserClaim, now: Date): 'low' | 'medium' | 'high' {
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
  const recent = claim.evidence.filter(
    e => now.getTime() - new Date(e.observedAt).getTime() < NINETY_DAYS,
  );
  const explicit = recent.filter(e => e.explicit).length;
  const inferred = recent.length - explicit;

  if (explicit >= 1 && recent.length >= 2) return 'high';
  if (explicit >= 1 || inferred >= 3) return 'medium';
  return 'low';
}

/**
 * Renders a claim so the agent can say *why* it believes something when asked.
 * This is what makes the profile correctable in conversation.
 */
export function explainClaim(claim: UserClaim, now: Date): string {
  const confidence = claimConfidence(claim, now);
  const newest = [...claim.evidence].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  const basis = claim.evidence.some(e => e.explicit) ? 'you told me directly' : 'I inferred it';
  return `${claim.claim} (${confidence} confidence — ${basis}; ${claim.evidence.length} observation(s), most recently ${newest?.observedAt ?? 'unknown'})`;
}

/**
 * Applies a user correction.
 *
 * The old claim is retracted rather than deleted: keeping it prevents the learning
 * pipeline from cheerfully re-deriving the same wrong claim next week.
 */
export function correctClaim(
  existing: UserClaim,
  correction: { claim: string; source: string; now: Date },
): { retracted: UserClaim; replacement: UserClaim } {
  const at = correction.now.toISOString();
  return {
    retracted: {
      ...existing,
      status: 'retracted',
      retractedReason: `superseded by a direct correction at ${at}`,
      updatedAt: at,
    },
    replacement: {
      ...existing,
      id: `${existing.id}.v${existing.evidence.length + 1}`,
      claim: correction.claim,
      status: 'corrected',
      evidence: [
        {
          observation: `User corrected: "${correction.claim}"`,
          source: correction.source,
          observedAt: at,
          explicit: true,
        },
      ],
      retractedReason: undefined,
      createdAt: at,
      updatedAt: at,
    },
  };
}
