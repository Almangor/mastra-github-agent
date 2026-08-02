import { z } from 'zod';

import { RoleSchema, type Role } from './request-context.ts';

/**
 * Tool-risk tiers (plan: "Tool-risk tiers", "typed, approval-gated business tools").
 *
 * The tier is a property of the *tool*, declared once at definition time. It is not
 * something an agent can choose, argue about, or infer — which is the point. A
 * prompt-injected instruction cannot lower a tool's tier because the tier never
 * travels through the model.
 */
export const RiskTierSchema = z.enum([
  /** Read-only, no side effects, safe to expose to any principal. */
  'tier0_read',
  /** Writes that only affect agent-owned state (memory, drafts, notes). */
  'tier1_internal_write',
  /** Writes visible to the company: Linear issues, docs, calendar holds. */
  'tier2_business_write',
  /** Irreversible or externally-visible: sending mail, financial ops, comms. */
  'tier3_critical',
]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const RISK_TIER_ORDER: RiskTier[] = [
  'tier0_read',
  'tier1_internal_write',
  'tier2_business_write',
  'tier3_critical',
];

export function tierRank(tier: RiskTier): number {
  return RISK_TIER_ORDER.indexOf(tier);
}

/** Declared alongside every business tool; consumed by @ceo/policy. */
export const ToolDescriptorSchema = z
  .object({
    id: z.string().min(1),
    tier: RiskTierSchema,
    /** Human-readable summary used in approval cards. */
    summary: z.string().min(1),
    /** Which integration the tool reaches. Used for blast-radius reporting. */
    system: z.string().min(1),
    /**
     * Whether the effect can be undone by the agent itself. Irreversible tools
     * always require approval regardless of tier.
     */
    reversible: z.boolean(),
    /**
     * Surfaces on which the tool may be offered at all. A tier-2 write is never
     * offered in an external channel even to a CEO.
     */
    allowedSurfaces: z.array(z.enum(['dm', 'channel', 'scheduled', 'admin_cli'])).nonempty(),
  })
  .strict();
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

/**
 * Who may *approve* an action at each tier. Distinct from who may *invoke* it:
 * staff can request a tier-2 write, but only an exec or the CEO can release it.
 *
 * `system` appears in no list — a scheduled run can never approve its own work.
 */
export const APPROVER_ROLES: Record<RiskTier, Role[]> = {
  tier0_read: [],
  tier1_internal_write: [],
  tier2_business_write: ['exec', 'ceo'],
  tier3_critical: ['ceo'],
};

/** Who may cause the action to be attempted at all. */
export const INVOKER_ROLES: Record<RiskTier, Role[]> = {
  tier0_read: ['ceo', 'exec', 'staff', 'observer', 'system'],
  tier1_internal_write: ['ceo', 'exec', 'staff', 'system'],
  tier2_business_write: ['ceo', 'exec', 'staff', 'system'],
  tier3_critical: ['ceo', 'exec'],
};

export function requiresApproval(descriptor: ToolDescriptor): boolean {
  if (!descriptor.reversible) return true;
  return tierRank(descriptor.tier) >= tierRank('tier2_business_write');
}

export const RoleForApproval = RoleSchema;
