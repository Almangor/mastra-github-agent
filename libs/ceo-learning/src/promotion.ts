import {
  type PromotionEvidence,
  PromotionEvidenceSchema,
  type SkillState,
  unmetPromotionRequirements,
} from '@ceo/contracts';
import { type Skill, SkillRegistry, findDuplicate, validateSkill } from '@ceo/skills';

/**
 * The promotion pipeline (plan §3: "Every learned skill requires… 1–9").
 *
 * This is the only route from `proposed` to `active`, and each step is a gate that
 * writes evidence. The evidence record is what the "zero production skill
 * promotions without an eval record" release gate reads — so a promotion that
 * skipped a step is not merely discouraged, it is detectable after the fact.
 */

export interface EvalRunner {
  targeted(skill: Skill): Promise<{ passed: boolean; score: number; datasetVersion: string }>;
  regression(skill: Skill): Promise<{ passed: boolean; score: number; datasetVersion: string }>;
  adversarial(skill: Skill): Promise<{ passed: boolean; violations: number }>;
}

export interface PromotionOptions {
  registry: SkillRegistry;
  evals: EvalRunner;
  /** Percentage of traffic the canary may see. Plan caps this at 25. */
  canaryTrafficPercent: number;
  /** Minimum canary runs before a human may promote to active. */
  canaryMinRuns: number;
  /** Score drop that arms automatic rollback. */
  regressionThreshold: number;
  now?: () => Date;
}

export interface PromotionResult {
  /** Where the skill ended up. */
  state: SkillState;
  evidence: PromotionEvidence;
  /** Non-empty when the skill did not reach `awaiting_approval`. */
  blockedBy: string[];
}

/**
 * Runs requirements 1–6 and, if all pass, moves the skill to `awaiting_approval`.
 *
 * Deliberately stops there. Requirements 7–9 (approval, canary, rollback) are not
 * things this function can satisfy on its own — they need a human and live traffic,
 * which is the entire point of the design.
 */
export async function runValidationPipeline(
  skill: Skill,
  options: PromotionOptions,
): Promise<PromotionResult> {
  const { registry, evals, canaryTrafficPercent, canaryMinRuns, regressionThreshold, now = () => new Date() } = options;

  registry.transition({
    id: skill.id,
    version: skill.version,
    to: 'validating',
    by: 'validator',
    actorId: 'promotion-pipeline',
    reason: 'entering validation',
    now: now(),
  });

  // 2. duplicate detection
  const duplicate = findDuplicate(skill, registry.all());

  // 3. static + security validation
  const staticValidation = validateSkill(skill);

  // 4–6. evals. Run sequentially so a static failure short-circuits the spend.
  const shouldRunEvals = staticValidation.passed && !duplicate;
  const targeted = shouldRunEvals
    ? await evals.targeted(skill)
    : { passed: false, score: 0, datasetVersion: 'not-run' };
  const regression = shouldRunEvals && targeted.passed
    ? await evals.regression(skill)
    : { passed: false, score: 0, datasetVersion: 'not-run' };
  const adversarial = shouldRunEvals && regression.passed
    ? await evals.adversarial(skill)
    : { passed: false, violations: shouldRunEvals ? 1 : 0 };

  const evidence = PromotionEvidenceSchema.parse({
    evidenceRunIds: skill.evidenceRunIds,
    duplicateCheck: {
      passed: !duplicate,
      nearestSkillId: duplicate?.skill.id,
      similarity: duplicate?.similarity ?? 0,
    },
    staticValidation,
    targetedEvals: targeted,
    regressionEvals: regression,
    adversarialEvals: adversarial,
    // 7. Every skill promotion requires a human release, regardless of content.
    approval: { required: true },
    // 8–9.
    canary: { trafficPercent: canaryTrafficPercent, minRuns: canaryMinRuns },
    rollback: { armed: true, regressionThreshold },
  });

  // Requirement 7 is satisfied by the human, not here, so exclude it from the
  // blocking set at this stage.
  const blockedBy = unmetPromotionRequirements(evidence).filter(r => !r.startsWith('7:'));

  const destination: SkillState = blockedBy.length === 0 ? 'awaiting_approval' : 'failed';
  registry.transition({
    id: skill.id,
    version: skill.version,
    to: destination,
    by: 'validator',
    actorId: 'promotion-pipeline',
    reason: blockedBy.length === 0 ? 'all automated gates passed' : blockedBy.join('; '),
    now: now(),
  });

  return { state: destination, evidence, blockedBy };
}

/**
 * Canary regression monitor (requirement 9).
 *
 * Compares canary performance against the pre-promotion baseline and returns the
 * rollback decision. Called by the worker on a schedule while a canary is live.
 */
export function shouldRollBack(input: {
  baselineScore: number;
  canaryScore: number;
  canaryRuns: number;
  minRuns: number;
  regressionThreshold: number;
}): { rollback: boolean; reason: string } {
  const { baselineScore, canaryScore, canaryRuns, minRuns, regressionThreshold } = input;

  // Not enough signal yet — do not roll back on noise.
  if (canaryRuns < minRuns) {
    return { rollback: false, reason: `only ${canaryRuns}/${minRuns} canary runs so far` };
  }
  const drop = baselineScore - canaryScore;
  if (drop >= regressionThreshold) {
    return {
      rollback: true,
      reason: `canary scored ${canaryScore.toFixed(3)} vs baseline ${baselineScore.toFixed(3)} (drop ${drop.toFixed(3)} ≥ ${regressionThreshold})`,
    };
  }
  return { rollback: false, reason: `no regression (drop ${drop.toFixed(3)} < ${regressionThreshold})` };
}
