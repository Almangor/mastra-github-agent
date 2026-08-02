import { randomUUID } from 'node:crypto';

import {
  APPROVAL_TTL_MS,
  APPROVER_ROLES,
  type ApprovalDecision,
  type ApprovalRequest,
  ApprovalRequestSchema,
  type RequestContext,
  type ToolDescriptor,
} from '@ceo/contracts';
import type { AccessPolicy } from '@ceo/policy';
import type { AuditSink, Logger } from '@ceo/platform-observability';

import type { ToolRuntime } from './guarded-tool.ts';

/**
 * Per-turn runtime plumbing.
 *
 * Tools are defined once at module load, but the context they must be checked
 * against changes every turn. `TurnRuntimeHolder` is the mutable cell the tool
 * factory's `getRuntime` thunk reads: the runtime sets it before the agent runs
 * and clears it after, so a tool can never execute against a stale identity.
 */

export interface ApprovalStore {
  find(input: { workspaceId: string; toolId: string; argumentsHash: string }): Promise<
    { request: ApprovalRequest; decision: ApprovalDecision } | undefined
  >;
  create(request: ApprovalRequest): Promise<void>;
  decide(decision: ApprovalDecision): Promise<void>;
  pending(workspaceId: string): Promise<ApprovalRequest[]>;
}

export class InMemoryApprovalStore implements ApprovalStore {
  readonly #requests = new Map<string, ApprovalRequest>();
  readonly #decisions = new Map<string, ApprovalDecision>();

  async find(input: { workspaceId: string; toolId: string; argumentsHash: string }) {
    for (const request of this.#requests.values()) {
      if (
        request.workspaceId === input.workspaceId &&
        request.toolId === input.toolId &&
        request.argumentsHash === input.argumentsHash
      ) {
        const decision = this.#decisions.get(request.approvalId);
        if (decision) return { request, decision };
      }
    }
    return undefined;
  }

  async create(request: ApprovalRequest): Promise<void> {
    this.#requests.set(request.approvalId, ApprovalRequestSchema.parse(request));
  }

  async decide(decision: ApprovalDecision): Promise<void> {
    if (!this.#requests.has(decision.approvalId)) {
      throw new Error(`no approval request ${decision.approvalId}`);
    }
    this.#decisions.set(decision.approvalId, decision);
  }

  async pending(workspaceId: string): Promise<ApprovalRequest[]> {
    return [...this.#requests.values()].filter(
      r => r.workspaceId === workspaceId && !this.#decisions.has(r.approvalId),
    );
  }
}

export interface TurnRuntimeDeps {
  policy: AccessPolicy;
  audit: AuditSink;
  logger: Logger;
  approvals: ApprovalStore;
  /** Overridable so evals can run against a fixed clock. */
  clock?: () => Date;
}

/**
 * Holds the active turn. `current()` throws rather than returning a permissive
 * default — a tool executing outside a turn is a bug we want to fail loudly, not
 * a case to paper over with an anonymous context.
 */
export class TurnRuntimeHolder {
  #active: ToolRuntime | undefined;

  constructor(private readonly deps: TurnRuntimeDeps) {}

  current(): ToolRuntime {
    if (!this.#active) {
      throw new Error('no active turn: a guarded tool was invoked outside of a request context');
    }
    return this.#active;
  }

  /** Runs `work` with `context` installed, guaranteeing teardown. */
  async withTurn<T>(
    input: { context: RequestContext; agentId: string },
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#active;
    this.#active = this.#build(input.context, input.agentId);
    try {
      return await work();
    } finally {
      this.#active = previous;
    }
  }

  #build(context: RequestContext, agentId: string): ToolRuntime {
    const { policy, audit, logger, approvals, clock = () => new Date() } = this.deps;
    return {
      policy,
      context,
      audit,
      logger: logger.forRequest(context),
      agentId,
      now: clock,
      findApproval: ({ toolId, argumentsHash }) =>
        approvals.find({ workspaceId: context.workspaceId, toolId, argumentsHash }),
      requestApproval: async ({ descriptor, argumentsHash, renderedSummary }) => {
        const request = buildApprovalRequest({
          context,
          descriptor,
          argumentsHash,
          renderedSummary,
          now: clock(),
        });
        await approvals.create(request);
        return request;
      },
    };
  }
}

export function buildApprovalRequest(input: {
  context: RequestContext;
  descriptor: ToolDescriptor;
  argumentsHash: string;
  renderedSummary: string;
  now: Date;
}): ApprovalRequest {
  const { context, descriptor, argumentsHash, renderedSummary, now } = input;
  return ApprovalRequestSchema.parse({
    approvalId: randomUUID(),
    requestId: context.requestId,
    workspaceId: context.workspaceId,
    toolId: descriptor.id,
    tier: descriptor.tier,
    argumentsHash,
    summary: renderedSummary,
    blastRadius: `${descriptor.system} · ${descriptor.reversible ? 'reversible' : 'IRREVERSIBLE'}`,
    reversible: descriptor.reversible,
    requestedBy: context.userId,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    eligibleApproverRoles: APPROVER_ROLES[descriptor.tier].length
      ? APPROVER_ROLES[descriptor.tier]
      : ['ceo'],
  });
}
