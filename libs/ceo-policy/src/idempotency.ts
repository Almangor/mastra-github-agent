/**
 * Event deduplication and idempotent processing (plan §1).
 *
 * Slack retries an event delivery if it does not get a 2xx within three seconds,
 * and it retries with the *same* `X-Slack-Retry-Num` envelope. Without a dedup
 * gate, a slow model turn produces three identical executive briefs, or worse,
 * three identical tier-2 writes.
 *
 * The contract here is deliberately small so it can be backed by memory in tests
 * and by Postgres/Redis in production without the caller noticing.
 */

export interface IdempotencyStore {
  /**
   * Atomically claims `key`. Returns true if this caller won the claim and should
   * do the work; false if the key was already claimed.
   */
  claim(key: string, ttlMs: number): Promise<boolean>;
  /** Records the terminal outcome so a late redelivery can be answered cheaply. */
  complete(key: string, outcome: 'ok' | 'error'): Promise<void>;
  status(key: string): Promise<'unseen' | 'in_flight' | 'ok' | 'error'>;
}

/** Default window. Slack gives up retrying well inside this. */
export const DEDUP_TTL_MS = 60 * 60 * 1000;

/**
 * Builds the dedup key. Slack's event id is unique per *delivery attempt group*,
 * so it is the right key; we namespace by workspace to keep tenants isolated even
 * if Slack ever reuses an id.
 */
export function dedupKey(input: { workspaceId: string; eventId: string }): string {
  return `evt:${input.workspaceId}:${input.eventId}`;
}

/** In-memory implementation. Used by tests and the eval harness. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #entries = new Map<string, { state: 'in_flight' | 'ok' | 'error'; expiresAt: number }>();

  #sweep(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    this.#sweep(now);
    if (this.#entries.has(key)) return false;
    this.#entries.set(key, { state: 'in_flight', expiresAt: now + ttlMs });
    return true;
  }

  async complete(key: string, outcome: 'ok' | 'error'): Promise<void> {
    const entry = this.#entries.get(key);
    if (entry) entry.state = outcome;
  }

  async status(key: string): Promise<'unseen' | 'in_flight' | 'ok' | 'error'> {
    this.#sweep(Date.now());
    return this.#entries.get(key)?.state ?? 'unseen';
  }
}

/**
 * Runs `work` at most once per key.
 *
 * Callers should acknowledge Slack *before* awaiting this (plan §1: "Immediate
 * acknowledgement before any model work") — the ack and the work are separate
 * concerns, and this helper only guards the work.
 */
export async function runOnce<T>(
  store: IdempotencyStore,
  key: string,
  work: () => Promise<T>,
  ttlMs: number = DEDUP_TTL_MS,
): Promise<{ ran: true; result: T } | { ran: false; reason: 'duplicate' }> {
  const won = await store.claim(key, ttlMs);
  if (!won) return { ran: false, reason: 'duplicate' };
  try {
    const result = await work();
    await store.complete(key, 'ok');
    return { ran: true, result };
  } catch (error) {
    await store.complete(key, 'error');
    throw error;
  }
}
