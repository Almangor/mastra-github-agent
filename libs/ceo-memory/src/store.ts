import { randomUUID } from 'node:crypto';

import type { RequestContext } from '@ceo/contracts';
import { assertSameMemoryPartition } from '@ceo/policy';

import {
  LAYER_POLICIES,
  type MemoryEntry,
  MemoryEntrySchema,
  type MemoryLayer,
  expiryFor,
} from './layers.ts';

/**
 * The memory store and its isolation guarantees.
 *
 * Every read and write goes through a RequestContext, and the partition key is
 * taken from that context rather than from an argument. A caller cannot ask for
 * "the DM partition" while serving a channel turn, because there is no parameter
 * for it — which is how the "zero DM-to-channel leakage" gate stays true by
 * construction rather than by vigilance.
 */

export interface MemoryQuery {
  layers?: MemoryLayer[];
  tags?: string[];
  /** Naive substring match in the reference store; a vector search in production. */
  contains?: string;
  limit?: number;
}

export interface MemoryStore {
  write(context: RequestContext, input: WriteInput): Promise<MemoryEntry>;
  read(context: RequestContext, query?: MemoryQuery): Promise<MemoryEntry[]>;
  /**
   * Cross-conversation search (a Hermes capability, plan §3). Deliberately
   * restricted to workspace-scoped layers: searching another person's DM history
   * is exactly the leak we are guarding against.
   */
  searchWorkspace(context: RequestContext, query: MemoryQuery): Promise<MemoryEntry[]>;
  forget(context: RequestContext, entryId: string): Promise<boolean>;
}

export interface WriteInput {
  layer: MemoryLayer;
  content: string;
  tags?: string[];
  source?: string;
  /**
   * Required for any layer whose write policy is `consented`. Passing this is an
   * assertion that a human agreed — the learning pipeline cannot self-certify.
   */
  consent?: { grantedBy: string; grantedAt: string };
  now?: Date;
}

export class ConsentRequiredError extends Error {
  constructor(layer: MemoryLayer) {
    super(`writing to the "${layer}" memory layer requires recorded consent`);
    this.name = 'ConsentRequiredError';
  }
}

export class LayerNotAgentWritableError extends Error {
  constructor(layer: MemoryLayer) {
    super(`the "${layer}" layer is human-only; route this through the skill pipeline`);
    this.name = 'LayerNotAgentWritableError';
  }
}

export class InMemoryMemoryStore implements MemoryStore {
  readonly #entries: MemoryEntry[] = [];

  async write(context: RequestContext, input: WriteInput): Promise<MemoryEntry> {
    const { layer, content, tags = [], source, consent, now = new Date() } = input;
    const policy = LAYER_POLICIES[layer];

    if (policy.write === 'human_only') throw new LayerNotAgentWritableError(layer);
    if (policy.write === 'consented' && !consent) throw new ConsentRequiredError(layer);

    // Workspace-scoped layers are shared, so they are keyed by workspace rather
    // than by the private conversation partition.
    const resourceId = policy.scope === 'workspace' ? `ws:${context.workspaceId}` : context.memoryResourceId;

    const entry = MemoryEntrySchema.parse({
      id: randomUUID(),
      layer,
      resourceId,
      workspaceId: context.workspaceId,
      content,
      tags,
      source,
      createdAt: now.toISOString(),
      expiresAt: expiryFor(layer, now),
    });

    this.#entries.push(entry);
    return entry;
  }

  async read(context: RequestContext, query: MemoryQuery = {}): Promise<MemoryEntry[]> {
    const now = Date.now();

    // Selection is by partition equality — a foreign partition is simply not
    // visible, never "visible then rejected".
    const visible = this.#entries.filter(entry => {
      if (entry.workspaceId !== context.workspaceId) return false;
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) return false;

      return LAYER_POLICIES[entry.layer].scope === 'workspace'
        ? entry.resourceId === `ws:${context.workspaceId}`
        : entry.resourceId === context.memoryResourceId;
    });

    // Defence in depth: if the filter above ever regresses, this turns a silent
    // cross-partition leak into a loud failure the eval gate will catch.
    for (const entry of visible) {
      if (LAYER_POLICIES[entry.layer].scope !== 'workspace') {
        assertSameMemoryPartition(context, entry.resourceId);
      }
    }

    return this.#apply(visible, query);
  }

  async searchWorkspace(context: RequestContext, query: MemoryQuery): Promise<MemoryEntry[]> {
    const workspaceLayers = (Object.keys(LAYER_POLICIES) as MemoryLayer[]).filter(
      layer => LAYER_POLICIES[layer].scope === 'workspace',
    );
    const requested = query.layers?.filter(layer => workspaceLayers.includes(layer)) ?? workspaceLayers;

    const now = Date.now();
    const candidates = this.#entries.filter(
      entry =>
        entry.workspaceId === context.workspaceId &&
        requested.includes(entry.layer) &&
        entry.resourceId === `ws:${context.workspaceId}` &&
        (!entry.expiresAt || new Date(entry.expiresAt).getTime() > now),
    );

    return this.#apply(candidates, { ...query, layers: requested });
  }

  async forget(context: RequestContext, entryId: string): Promise<boolean> {
    const index = this.#entries.findIndex(
      e => e.id === entryId && e.workspaceId === context.workspaceId,
    );
    if (index === -1) return false;
    this.#entries.splice(index, 1);
    return true;
  }

  #apply(entries: MemoryEntry[], query: MemoryQuery): MemoryEntry[] {
    let result = entries;
    if (query.layers) result = result.filter(e => query.layers!.includes(e.layer));
    if (query.tags?.length) result = result.filter(e => query.tags!.some(t => e.tags.includes(t)));
    if (query.contains) {
      const needle = query.contains.toLowerCase();
      result = result.filter(e => e.content.toLowerCase().includes(needle));
    }
    return result
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, query.limit ?? 50);
  }

  get size(): number {
    return this.#entries.length;
  }
}
