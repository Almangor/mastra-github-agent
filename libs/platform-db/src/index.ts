import { randomUUID } from 'node:crypto';

import type { Brief, Commitment, Decision, Meeting, Risk } from '@ceo/domain';

/**
 * @ceo/platform-db — executive-state persistence.
 *
 * The repository interface is what the workflows program against; the in-memory
 * implementation is what tests and evals use. A LibSQL/Postgres implementation
 * slots in behind the same interface without touching a workflow.
 *
 * Every method is workspace-scoped in its signature. Multi-tenant isolation is not
 * something a caller can forget to apply, because there is no un-scoped read.
 */

export interface Page<T> {
  items: T[];
  total: number;
}

export interface ExecutiveStore {
  // decisions
  saveDecision(decision: Decision): Promise<Decision>;
  getDecision(workspaceId: string, id: string): Promise<Decision | undefined>;
  listDecisions(workspaceId: string, filter?: { status?: Decision['status'] }): Promise<Page<Decision>>;

  // commitments
  saveCommitment(commitment: Commitment): Promise<Commitment>;
  listCommitments(
    workspaceId: string,
    filter?: { owner?: string; status?: Commitment['status']; dueBefore?: string },
  ): Promise<Page<Commitment>>;

  // risks
  saveRisk(risk: Risk): Promise<Risk>;
  listRisks(workspaceId: string, filter?: { status?: Risk['status'] }): Promise<Page<Risk>>;

  // briefs
  saveBrief(brief: Brief): Promise<Brief>;
  latestBrief(workspaceId: string, kind: Brief['kind']): Promise<Brief | undefined>;

  // meetings
  saveMeeting(meeting: Meeting): Promise<Meeting>;
  listMeetings(workspaceId: string, filter?: { from?: string; to?: string }): Promise<Page<Meeting>>;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Reference implementation. Deterministic and dependency-free. */
export class InMemoryExecutiveStore implements ExecutiveStore {
  readonly #decisions = new Map<string, Decision>();
  readonly #commitments = new Map<string, Commitment>();
  readonly #risks = new Map<string, Risk>();
  readonly #briefs: Brief[] = [];
  readonly #meetings = new Map<string, Meeting>();

  #key(workspaceId: string, id: string): string {
    return `${workspaceId}::${id}`;
  }

  async saveDecision(decision: Decision): Promise<Decision> {
    this.#decisions.set(this.#key(decision.workspaceId, decision.id), decision);
    return decision;
  }

  async getDecision(workspaceId: string, id: string): Promise<Decision | undefined> {
    return this.#decisions.get(this.#key(workspaceId, id));
  }

  async listDecisions(workspaceId: string, filter: { status?: Decision['status'] } = {}) {
    const items = [...this.#decisions.values()].filter(
      d => d.workspaceId === workspaceId && (filter.status === undefined || d.status === filter.status),
    );
    return { items, total: items.length };
  }

  async saveCommitment(commitment: Commitment): Promise<Commitment> {
    this.#commitments.set(this.#key(commitment.workspaceId, commitment.id), commitment);
    return commitment;
  }

  async listCommitments(
    workspaceId: string,
    filter: { owner?: string; status?: Commitment['status']; dueBefore?: string } = {},
  ) {
    const items = [...this.#commitments.values()].filter(c => {
      if (c.workspaceId !== workspaceId) return false;
      if (filter.owner !== undefined && c.owner !== filter.owner) return false;
      if (filter.status !== undefined && c.status !== filter.status) return false;
      if (filter.dueBefore !== undefined) {
        if (!c.dueAt) return false;
        if (new Date(c.dueAt).getTime() >= new Date(filter.dueBefore).getTime()) return false;
      }
      return true;
    });
    return { items, total: items.length };
  }

  async saveRisk(risk: Risk): Promise<Risk> {
    this.#risks.set(this.#key(risk.workspaceId, risk.id), risk);
    return risk;
  }

  async listRisks(workspaceId: string, filter: { status?: Risk['status'] } = {}) {
    const items = [...this.#risks.values()].filter(
      r => r.workspaceId === workspaceId && (filter.status === undefined || r.status === filter.status),
    );
    return { items, total: items.length };
  }

  async saveBrief(brief: Brief): Promise<Brief> {
    this.#briefs.push(brief);
    return brief;
  }

  async latestBrief(workspaceId: string, kind: Brief['kind']): Promise<Brief | undefined> {
    return [...this.#briefs]
      .filter(b => b.workspaceId === workspaceId && b.kind === kind)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  }

  async saveMeeting(meeting: Meeting): Promise<Meeting> {
    this.#meetings.set(this.#key(meeting.workspaceId, meeting.id), meeting);
    return meeting;
  }

  async listMeetings(workspaceId: string, filter: { from?: string; to?: string } = {}) {
    const items = [...this.#meetings.values()].filter(m => {
      if (m.workspaceId !== workspaceId) return false;
      if (filter.from && m.startsAt < filter.from) return false;
      if (filter.to && m.startsAt > filter.to) return false;
      return true;
    });
    return { items, total: items.length };
  }
}
