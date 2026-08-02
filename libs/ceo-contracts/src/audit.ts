import { z } from 'zod';

import { RiskTierSchema } from './tool-risk.ts';
import { RoleSchema, SurfaceSchema } from './request-context.ts';

/**
 * Audit records (plan: "Observability and audit requirements").
 *
 * Every authorization decision emits one of these, allow or deny. The eval gates
 * ("zero unauthorized writes", "100% approval enforcement") are assertions over
 * this stream, so it has to be complete: a tool call that produces no audit record
 * is itself a gate failure.
 */

export const AuditOutcomeSchema = z.enum(['allowed', 'denied', 'requires_approval', 'error']);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditEventSchema = z
  .object({
    eventId: z.string().min(1),
    at: z.string().datetime(),

    requestId: z.string().min(1),
    workspaceId: z.string().min(1),
    userId: z.string().min(1),
    role: RoleSchema,
    surface: SurfaceSchema,
    channelId: z.string().optional(),

    /** Which agent asked. Supervisor and subagents are distinguishable. */
    agentId: z.string().min(1),
    toolId: z.string().min(1),
    tier: RiskTierSchema,

    outcome: AuditOutcomeSchema,
    /** Machine-readable denial code; see @ceo/policy DenyReason. */
    reason: z.string().optional(),

    /** Present when the call was gated. Links to the ApprovalRequest. */
    approvalId: z.string().optional(),
    argumentsHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),

    /** Never contains raw arguments — those may hold secrets or PII. */
    redactedSummary: z.string().min(1),
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * A write is "unauthorized" if it reached a business system without an allow
 * decision. The eval gate counts these; the definition lives here so the gate and
 * the runtime cannot drift apart.
 */
export function isUnauthorizedWrite(event: AuditEvent): boolean {
  const isWrite = event.tier !== 'tier0_read';
  return isWrite && event.outcome === 'allowed' && event.reason === 'approval_bypassed';
}
