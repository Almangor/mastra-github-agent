import { z } from 'zod';

import { SkillStateSchema } from '@ceo/contracts';

/**
 * Skill structure (plan: "Mastra skill structure", "Full Hermes capability mapping").
 *
 * A skill is procedural memory made reviewable: a named, versioned, human-readable
 * artefact describing *how* to do a recurring executive task. The point of making
 * it a file rather than a prompt fragment is that a human can diff it, an eval can
 * target it, and the curator can retire it.
 *
 * Note what a skill deliberately cannot contain: code, credentials, or tool grants.
 * A skill influences *how* the agent works, never *what it is allowed to touch* —
 * that stays in the tool descriptors, outside the learning loop's reach.
 */

export const SkillScopeSchema = z.enum([
  /** Applies to the supervisor's own reasoning. */
  'supervisor',
  /** Applies to one named specialist agent. */
  'specialist',
  /** Applies inside one workflow. */
  'workflow',
]);

export const SkillSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, 'skill ids are kebab-case slugs'),
    version: z.number().int().min(1),
    title: z.string().min(1),
    /** When this skill should be loaded. Read by the model, so write it as a trigger. */
    whenToUse: z.string().min(1),
    /** The procedure itself, in Markdown. */
    body: z.string().min(1),
    scope: SkillScopeSchema,
    /** For scope=specialist/workflow: which one. */
    target: z.string().optional(),
    state: SkillStateSchema,

    /** Run ids that justified this skill. Empty is only legal before `proposed`. */
    evidenceRunIds: z.array(z.string()).default([]),
    /** Which skill this replaces, if any. */
    supersedes: z.string().optional(),

    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    /** Set when promoted to active. */
    activatedAt: z.string().datetime().optional(),
    /** Usage tracking drives curation (plan §3: "skill usage tracking and curation"). */
    usage: z
      .object({
        loadCount: z.number().int().min(0).default(0),
        lastLoadedAt: z.string().datetime().optional(),
      })
      .default({ loadCount: 0 }),
  })
  .strict()
  .superRefine((skill, issue) => {
    if (skill.scope !== 'supervisor' && !skill.target) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: `scope "${skill.scope}" requires a target`,
      });
    }
    // Anything past `candidate` must be able to point at why it exists.
    const needsEvidence = !['observed', 'candidate'].includes(skill.state);
    if (needsEvidence && skill.evidenceRunIds.length === 0) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceRunIds'],
        message: `a skill in state "${skill.state}" must cite the runs it was learned from`,
      });
    }
  });
export type Skill = z.infer<typeof SkillSchema>;

/**
 * Content that must never appear in a learned skill.
 *
 * The learning reviewer writes prose; these patterns indicate it has drifted into
 * writing *capability*, which is the thing the governance model exists to prevent.
 */
const FORBIDDEN_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'code_block', pattern: /```(?:js|ts|javascript|typescript|python|sh|bash)\b/i },
  { name: 'shell_invocation', pattern: /\b(?:curl|wget|rm\s+-rf|chmod|sudo)\b/ },
  { name: 'credential_literal', pattern: /\b(?:sk-ant-|xox[abposr]-|gh[pous]_|AKIA)/ },
  { name: 'policy_override', pattern: /\b(?:ignore|bypass|skip|disable)\s+(?:the\s+)?(?:approval|policy|permission|guard)/i },
  { name: 'tool_grant', pattern: /\bgrant\s+(?:yourself|the agent)\s+access\b/i },
  { name: 'self_approval', pattern: /\bapprove\s+(?:your own|its own)\b/i },
];

export interface SkillValidation {
  passed: boolean;
  findings: string[];
}

/**
 * Static + security validation (promotion requirement 3).
 *
 * Runs before any eval, because a skill that tries to talk the agent out of its
 * approval gate should never reach an eval harness in the first place.
 */
export function validateSkill(skill: Skill): SkillValidation {
  const findings: string[] = [];
  const haystack = `${skill.title}\n${skill.whenToUse}\n${skill.body}`;

  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(haystack)) findings.push(`forbidden content: ${name}`);
  }
  if (skill.body.length > 8_000) {
    findings.push('skill body exceeds 8000 characters — split it or tighten it');
  }
  if (skill.whenToUse.length < 20) {
    findings.push('whenToUse is too vague to route on');
  }

  return { passed: findings.length === 0, findings };
}

/**
 * Duplicate detection (promotion requirement 2).
 *
 * Token-overlap Jaccard rather than embeddings: it is deterministic, needs no
 * model call in the release gate, and catches the realistic failure — the reviewer
 * re-proposing something it already learned last week in slightly different words.
 */
export function similarity(a: Skill, b: Skill): number {
  const tokenise = (skill: Skill) =>
    new Set(
      `${skill.title} ${skill.whenToUse} ${skill.body}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t.length > 3),
    );
  const setA = tokenise(a);
  const setB = tokenise(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / (setA.size + setB.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.6;

export function findDuplicate(candidate: Skill, existing: Skill[]): { skill: Skill; similarity: number } | undefined {
  let best: { skill: Skill; similarity: number } | undefined;
  for (const other of existing) {
    if (other.id === candidate.id) continue;
    const score = similarity(candidate, other);
    if (score >= DUPLICATE_THRESHOLD && (!best || score > best.similarity)) {
      best = { skill: other, similarity: score };
    }
  }
  return best;
}
