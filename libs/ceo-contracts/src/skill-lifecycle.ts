import { z } from 'zod';

/**
 * Governed skill lifecycle (plan §3).
 *
 * Hermes-style learning gives us persistent memory, a deepening user profile, and
 * skills created from successful experience. The risk it introduces is a system
 * that rewrites its own behaviour. The plan's answer is that learning is
 * *proposal-only*: the reviewer can move a skill to `proposed` and no further.
 * Every edge past that point is driven by validation, evals, a human, or a rollback.
 *
 *   observed → candidate → proposed → validating → awaiting_approval → canary → active
 *   any stage → rejected | failed | superseded | rolled_back
 *   active → stale → archived
 */

export const SkillStateSchema = z.enum([
  /** A recurring pattern was noticed in traces. No artefact yet. */
  'observed',
  /** Enough evidence to be worth drafting. */
  'candidate',
  /** Drafted by the learning reviewer. This is as far as learning can push it. */
  'proposed',
  /** Static analysis, security checks, duplicate detection, evals in progress. */
  'validating',
  /** All gates green; a human with the right role must release it. */
  'awaiting_approval',
  /** Live for a limited slice of traffic with automatic rollback armed. */
  'canary',
  /** Fully promoted. */
  'active',

  // terminal / off-ramp states
  /** A human declined it. */
  'rejected',
  /** A validation or eval gate failed. */
  'failed',
  /** Replaced by a newer skill covering the same ground. */
  'superseded',
  /** Was active or canary; pulled back after a regression. */
  'rolled_back',
  /** Active but unused for long enough to be a curation candidate. */
  'stale',
  /** Retired. Retained for audit, never loaded. */
  'archived',
]);
export type SkillState = z.infer<typeof SkillStateSchema>;

/** The actor permitted to drive a transition. Enforced by @ceo/learning. */
export const TransitionActorSchema = z.enum([
  /** The post-run learning reviewer. Proposal authority only. */
  'learning_reviewer',
  /** Automated validation + eval pipeline. */
  'validator',
  /** A human with an approver role. */
  'human_approver',
  /** The curator job that ages skills out. */
  'curator',
  /** Automatic rollback triggered by canary regression. */
  'rollback_monitor',
]);
export type TransitionActor = z.infer<typeof TransitionActorSchema>;

interface Edge {
  to: SkillState;
  by: TransitionActor[];
}

/**
 * The complete legal transition table. Anything not listed here is rejected by
 * `assertTransition`, which is the single choke point for skill state changes.
 *
 * Note that `learning_reviewer` appears on exactly three edges and never past
 * `proposed`. That is the plan's central safety property, expressed as data.
 */
export const TRANSITIONS: Record<SkillState, Edge[]> = {
  observed: [
    { to: 'candidate', by: ['learning_reviewer'] },
    { to: 'rejected', by: ['human_approver', 'curator'] },
  ],
  candidate: [
    { to: 'proposed', by: ['learning_reviewer'] },
    // Superseding is a curation act, not a proposal act. Leaving the reviewer off
    // this edge keeps its reachable set to exactly {candidate, proposed}, which is
    // the invariant the promotion eval suite asserts exhaustively.
    { to: 'superseded', by: ['curator'] },
    { to: 'rejected', by: ['human_approver', 'curator'] },
  ],
  proposed: [
    { to: 'validating', by: ['validator'] },
    { to: 'rejected', by: ['human_approver'] },
    { to: 'superseded', by: ['curator'] },
  ],
  validating: [
    { to: 'awaiting_approval', by: ['validator'] },
    { to: 'failed', by: ['validator'] },
  ],
  awaiting_approval: [
    { to: 'canary', by: ['human_approver'] },
    { to: 'rejected', by: ['human_approver'] },
  ],
  canary: [
    { to: 'active', by: ['human_approver', 'validator'] },
    { to: 'rolled_back', by: ['rollback_monitor', 'human_approver'] },
    { to: 'failed', by: ['validator'] },
  ],
  active: [
    { to: 'stale', by: ['curator'] },
    { to: 'superseded', by: ['curator', 'human_approver'] },
    { to: 'rolled_back', by: ['rollback_monitor', 'human_approver'] },
  ],
  stale: [
    { to: 'active', by: ['curator'] },
    { to: 'archived', by: ['curator', 'human_approver'] },
  ],
  rejected: [],
  failed: [{ to: 'candidate', by: ['learning_reviewer'] }],
  superseded: [{ to: 'archived', by: ['curator'] }],
  rolled_back: [
    { to: 'candidate', by: ['learning_reviewer'] },
    { to: 'archived', by: ['curator', 'human_approver'] },
  ],
  archived: [],
};

export class IllegalSkillTransition extends Error {
  constructor(
    readonly from: SkillState,
    readonly to: SkillState,
    readonly by: TransitionActor,
  ) {
    super(`illegal skill transition ${from} → ${to} by ${by}`);
    this.name = 'IllegalSkillTransition';
  }
}

export function canTransition(from: SkillState, to: SkillState, by: TransitionActor): boolean {
  return (TRANSITIONS[from] ?? []).some(edge => edge.to === to && edge.by.includes(by));
}

export function assertTransition(from: SkillState, to: SkillState, by: TransitionActor): void {
  if (!canTransition(from, to, by)) throw new IllegalSkillTransition(from, to, by);
}

/** States in which a skill may be loaded into an agent's context. */
export const LOADABLE_STATES: SkillState[] = ['canary', 'active'];

export function isLoadable(state: SkillState): boolean {
  return LOADABLE_STATES.includes(state);
}

/**
 * The nine mandatory promotion requirements (plan §3). Each must be satisfied and
 * recorded before a skill may leave `validating`.
 */
export const PromotionEvidenceSchema = z
  .object({
    /** 1. Evidence from successful runs or explicit teaching. */
    evidenceRunIds: z.array(z.string().min(1)).min(1),
    /** 2. Duplicate-skill detection. */
    duplicateCheck: z.object({ passed: z.boolean(), nearestSkillId: z.string().optional(), similarity: z.number().min(0).max(1) }),
    /** 3. Static and security validation. */
    staticValidation: z.object({ passed: z.boolean(), findings: z.array(z.string()) }),
    /** 4. Targeted evals. */
    targetedEvals: z.object({ passed: z.boolean(), score: z.number().min(0).max(1), datasetVersion: z.string() }),
    /** 5. Global regression evals. */
    regressionEvals: z.object({ passed: z.boolean(), score: z.number().min(0).max(1), datasetVersion: z.string() }),
    /** 6. Adversarial tests. */
    adversarialEvals: z.object({ passed: z.boolean(), violations: z.number().int().min(0) }),
    /** 7. Approval according to risk. */
    approval: z.object({ approvalId: z.string().optional(), required: z.boolean() }),
    /** 8. Limited canary exposure. */
    canary: z.object({ trafficPercent: z.number().min(0).max(100), minRuns: z.number().int().min(1) }),
    /** 9. Automatic rollback. */
    rollback: z.object({ armed: z.boolean(), regressionThreshold: z.number().min(0).max(1) }),
  })
  .strict();
export type PromotionEvidence = z.infer<typeof PromotionEvidenceSchema>;

/** Returns the unmet promotion requirements, by number, for reporting. */
export function unmetPromotionRequirements(evidence: PromotionEvidence): string[] {
  const unmet: string[] = [];
  if (evidence.evidenceRunIds.length === 0) unmet.push('1: no supporting run evidence');
  if (!evidence.duplicateCheck.passed) unmet.push('2: duplicate-skill detection failed');
  if (!evidence.staticValidation.passed) unmet.push('3: static/security validation failed');
  if (!evidence.targetedEvals.passed) unmet.push('4: targeted evals failed');
  if (!evidence.regressionEvals.passed) unmet.push('5: global regression evals failed');
  if (!evidence.adversarialEvals.passed || evidence.adversarialEvals.violations > 0)
    unmet.push('6: adversarial tests failed');
  if (evidence.approval.required && !evidence.approval.approvalId) unmet.push('7: required approval missing');
  if (evidence.canary.trafficPercent <= 0 || evidence.canary.trafficPercent > 25)
    unmet.push('8: canary exposure must be >0% and <=25%');
  if (!evidence.rollback.armed) unmet.push('9: automatic rollback not armed');
  return unmet;
}
