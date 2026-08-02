import { z } from 'zod';

import { RiskTierSchema } from './tool-risk.ts';
import { RoleSchema } from './request-context.ts';

/**
 * Approval envelope (plan §1: "Block Kit approval cards", "100% approval
 * enforcement on gated actions").
 *
 * An approval is a *record*, not a flag. It names the exact action, the exact
 * arguments hash, who released it, and when it expires. That means an approval
 * cannot be replayed against different arguments, which is the attack an
 * "approved: true" boolean invites.
 */

export const ApprovalStateSchema = z.enum([
  'pending',
  'approved',
  'denied',
  'expired',
  /** Requested action no longer applies (e.g. the plan changed). */
  'withdrawn',
]);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const ApprovalRequestSchema = z
  .object({
    approvalId: z.string().min(1),
    requestId: z.string().min(1),
    workspaceId: z.string().min(1),

    toolId: z.string().min(1),
    tier: RiskTierSchema,

    /**
     * SHA-256 of the canonicalised tool arguments. The executor recomputes this
     * at release time and refuses if it differs — so an approved action cannot
     * have its arguments swapped after the fact.
     */
    argumentsHash: z.string().regex(/^[a-f0-9]{64}$/, 'argumentsHash must be a hex sha256'),

    /** Rendered for the human. Must describe the real effect, not the tool name. */
    summary: z.string().min(1),
    blastRadius: z.string().min(1),
    reversible: z.boolean(),

    requestedBy: z.string().min(1),
    requestedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),

    eligibleApproverRoles: z.array(RoleSchema).nonempty(),
  })
  .strict();
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionSchema = z
  .object({
    approvalId: z.string().min(1),
    state: ApprovalStateSchema,
    decidedBy: z.string().min(1).optional(),
    decidedByRole: RoleSchema.optional(),
    decidedAt: z.string().datetime().optional(),
    /** Required on denial so the agent can adjust rather than retry blindly. */
    reason: z.string().optional(),
  })
  .strict()
  .superRefine((decision, issue) => {
    if ((decision.state === 'approved' || decision.state === 'denied') && !decision.decidedBy) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decidedBy'],
        message: 'an approved/denied decision must record who made it',
      });
    }
    if (decision.state === 'denied' && !decision.reason) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'denials must carry a reason so the agent can adapt',
      });
    }
  });
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** Default validity window for an approval card before it lapses. */
export const APPROVAL_TTL_MS = 30 * 60 * 1000;
