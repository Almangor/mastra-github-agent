import { z } from 'zod';

/**
 * Six-layer memory architecture (plan: "Six-layer memory architecture",
 * "Explainable user-model claims").
 *
 * Layers differ along three axes that actually matter operationally: how long the
 * content survives, who is allowed to read it, and whether the *agent* may write
 * it without a human. Collapsing them into one vector store loses all three.
 *
 *   1 working      — this turn only. Scratch.
 *   2 episodic     — this conversation/thread. Verbatim history.
 *   3 semantic     — durable facts about the business. Cited, never inferred silently.
 *   4 profile      — the user model. Every claim carries evidence (see claims.ts).
 *   5 procedural   — how to do things. Backed by versioned skills, human-gated.
 *   6 organisational — cross-conversation corpus: decisions, commitments, briefs.
 */

export const MemoryLayerSchema = z.enum([
  'working',
  'episodic',
  'semantic',
  'profile',
  'procedural',
  'organisational',
]);
export type MemoryLayer = z.infer<typeof MemoryLayerSchema>;

export interface LayerPolicy {
  /** How long an entry survives without being refreshed. */
  ttlMs: number | 'permanent';
  /**
   * Whether the agent may write this layer autonomously, or whether writes must
   * go through the learning pipeline / an explicit human act.
   */
  write: 'agent' | 'consented' | 'human_only';
  /**
   * Partition scope. `turn` and `conversation` are isolated by memoryResourceId;
   * `workspace` layers are shared, which is why they are consent-gated.
   */
  scope: 'turn' | 'conversation' | 'workspace';
  /** Whether entries must carry provenance to be stored at all. */
  requiresProvenance: boolean;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const LAYER_POLICIES: Record<MemoryLayer, LayerPolicy> = {
  working: { ttlMs: HOUR, write: 'agent', scope: 'turn', requiresProvenance: false },
  episodic: { ttlMs: 30 * DAY, write: 'agent', scope: 'conversation', requiresProvenance: false },
  // Business facts are shared and long-lived, so they must be attributable.
  semantic: { ttlMs: 'permanent', write: 'consented', scope: 'workspace', requiresProvenance: true },
  // The user model is the highest-blast-radius layer: wrong claims here bias
  // every future turn. Consent-gated and always evidence-backed.
  profile: { ttlMs: 'permanent', write: 'consented', scope: 'workspace', requiresProvenance: true },
  // Procedural memory is skills. Only the governed pipeline may promote one.
  procedural: { ttlMs: 'permanent', write: 'human_only', scope: 'workspace', requiresProvenance: true },
  organisational: { ttlMs: 'permanent', write: 'consented', scope: 'workspace', requiresProvenance: true },
};

export const MemoryEntrySchema = z
  .object({
    id: z.string().min(1),
    layer: MemoryLayerSchema,
    /** Partition key from RequestContext. Never derived locally — see policy. */
    resourceId: z.string().min(1),
    workspaceId: z.string().min(1),
    content: z.string().min(1),
    /** Free-form tags used for retrieval filtering. */
    tags: z.array(z.string()).default([]),
    source: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((entry, issue) => {
    if (LAYER_POLICIES[entry.layer].requiresProvenance && !entry.source) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source'],
        message: `layer "${entry.layer}" requires provenance: every entry must cite where it came from`,
      });
    }
  });
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export function expiryFor(layer: MemoryLayer, now: Date): string | undefined {
  const { ttlMs } = LAYER_POLICIES[layer];
  return ttlMs === 'permanent' ? undefined : new Date(now.getTime() + ttlMs).toISOString();
}

/** Layers an autonomous agent turn may write without a consent decision. */
export function agentWritableLayers(): MemoryLayer[] {
  return (Object.keys(LAYER_POLICIES) as MemoryLayer[]).filter(
    layer => LAYER_POLICIES[layer].write === 'agent',
  );
}
