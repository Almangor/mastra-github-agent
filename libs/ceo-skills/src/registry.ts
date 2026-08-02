import {
  type SkillState,
  type TransitionActor,
  assertTransition,
  isLoadable,
} from '@ceo/contracts';

import { type Skill, SkillSchema } from './skill.ts';

/**
 * The skill registry — the single choke point for skill state.
 *
 * Every mutation goes through `transition`, which delegates to the contract's
 * transition table. That is what makes "the learning reviewer cannot publish a
 * skill" a property of the system rather than a promise in a prompt: there is no
 * other code path that changes a skill's state.
 */

export interface SkillTransitionRecord {
  skillId: string;
  version: number;
  from: SkillState;
  to: SkillState;
  by: TransitionActor;
  actorId: string;
  reason: string;
  at: string;
}

export class SkillRegistry {
  readonly #skills = new Map<string, Skill>();
  readonly #history: SkillTransitionRecord[] = [];

  #key(id: string, version: number): string {
    return `${id}@${version}`;
  }

  register(skill: Skill): Skill {
    const parsed = SkillSchema.parse(skill);
    this.#skills.set(this.#key(parsed.id, parsed.version), parsed);
    return parsed;
  }

  get(id: string, version: number): Skill | undefined {
    return this.#skills.get(this.#key(id, version));
  }

  all(): Skill[] {
    return [...this.#skills.values()];
  }

  /** Skills eligible to be loaded into a live agent: canary or active only. */
  loadable(scope?: Skill['scope'], target?: string): Skill[] {
    return this.all().filter(
      s =>
        isLoadable(s.state) &&
        (scope === undefined || s.scope === scope) &&
        (target === undefined || s.target === target),
    );
  }

  /**
   * Moves a skill between states.
   *
   * Throws `IllegalSkillTransition` when the actor is not permitted to make this
   * move — including the case the whole design exists for: the learning reviewer
   * attempting anything beyond `proposed`.
   */
  transition(input: {
    id: string;
    version: number;
    to: SkillState;
    by: TransitionActor;
    actorId: string;
    reason: string;
    now?: Date;
  }): Skill {
    const { id, version, to, by, actorId, reason, now = new Date() } = input;
    const skill = this.get(id, version);
    if (!skill) throw new Error(`unknown skill ${this.#key(id, version)}`);

    assertTransition(skill.state, to, by);

    const at = now.toISOString();
    const updated = SkillSchema.parse({
      ...skill,
      state: to,
      updatedAt: at,
      ...(to === 'active' ? { activatedAt: at } : {}),
    });

    this.#skills.set(this.#key(id, version), updated);
    this.#history.push({ skillId: id, version, from: skill.state, to, by, actorId, reason, at });
    return updated;
  }

  /** Records that a skill was loaded, which is what curation ages against. */
  recordUsage(id: string, version: number, now: Date = new Date()): void {
    const skill = this.get(id, version);
    if (!skill) return;
    this.#skills.set(this.#key(id, version), {
      ...skill,
      usage: { loadCount: skill.usage.loadCount + 1, lastLoadedAt: now.toISOString() },
    });
  }

  history(skillId?: string): SkillTransitionRecord[] {
    return skillId ? this.#history.filter(h => h.skillId === skillId) : [...this.#history];
  }
}

/** A skill unused for this long becomes a curation candidate. */
export const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Skill curation (plan §2 "skill curation and promotion", §3 "active, stale and
 * archived skill states").
 *
 * Returns the transitions the curator *should* make. Returning intents rather than
 * applying them keeps the decision reviewable and lets the admin CLI show a plan
 * before anything moves.
 */
export function planCuration(
  registry: SkillRegistry,
  now: Date = new Date(),
): { id: string; version: number; to: SkillState; reason: string }[] {
  const plan: { id: string; version: number; to: SkillState; reason: string }[] = [];

  for (const skill of registry.all()) {
    const lastUsed = skill.usage.lastLoadedAt ?? skill.activatedAt ?? skill.createdAt;
    const idleMs = now.getTime() - new Date(lastUsed).getTime();

    if (skill.state === 'active' && idleMs > STALE_AFTER_MS) {
      plan.push({
        id: skill.id,
        version: skill.version,
        to: 'stale',
        reason: `unused for ${Math.floor(idleMs / (24 * 60 * 60 * 1000))} days`,
      });
    }
    // A stale skill that got used again earns its way back.
    if (skill.state === 'stale' && idleMs <= STALE_AFTER_MS) {
      plan.push({ id: skill.id, version: skill.version, to: 'active', reason: 'used again recently' });
    }
    if (skill.state === 'stale' && idleMs > STALE_AFTER_MS * 2) {
      plan.push({ id: skill.id, version: skill.version, to: 'archived', reason: 'stale and still unused' });
    }
  }

  return plan;
}
