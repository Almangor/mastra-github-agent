import {
  APPROVER_ROLES,
  INVOKER_ROLES,
  type ApprovalDecision,
  type ApprovalRequest,
  type RequestContext,
  type ToolDescriptor,
  requiresApproval,
} from '@ceo/contracts';

import { type AccessPolicy, findChannelPolicy, findUserRole, findWorkspace } from './config.ts';

/**
 * The authorization decision procedure (plan §1).
 *
 * Two separate questions, deliberately not collapsed:
 *   1. `admitRequest`  — may this principal talk to the agent at all, here?
 *   2. `authorizeTool` — may this specific call proceed, and does it need release?
 *
 * Both are pure functions. No network, no clock beyond what is passed in, no
 * Mastra. That is what makes the security evals cheap enough to run on every
 * commit, and it is why @ceo/policy sits in the `domain` layer where the boundary
 * checker forbids it from importing an integration.
 */

export type DenyReason =
  | 'unknown_workspace'
  | 'unknown_user'
  | 'unknown_channel'
  | 'slack_connect_denied'
  | 'external_channel_write_denied'
  | 'surface_not_allowed_for_tool'
  | 'role_may_not_invoke'
  | 'approval_missing'
  | 'approval_not_approved'
  | 'approval_expired'
  | 'approval_arguments_mismatch'
  | 'approver_role_insufficient'
  | 'self_approval_denied';

export interface Admitted {
  ok: true;
  context: RequestContext;
}
export interface Denied {
  ok: false;
  reason: DenyReason;
  /** Safe to show a human. Never leaks whether a user/channel merely exists. */
  message: string;
}
export type AdmissionResult = Admitted | Denied;

const deny = (reason: DenyReason, message: string): Denied => ({ ok: false, reason, message });

/**
 * Gate 1: is this principal allowed to reach the agent on this surface?
 *
 * Note the context arrives already *shaped* by the Slack adapter but its `role`
 * and `channelPolicy` are re-derived here from our own config — we never trust
 * the values the adapter guessed.
 */
export function admitRequest(policy: AccessPolicy, context: RequestContext): AdmissionResult {
  const workspace = findWorkspace(policy, context.workspaceId);
  if (!workspace) {
    return deny('unknown_workspace', 'This workspace is not configured for the CEO agent.');
  }

  const role = findUserRole(workspace, context.userId);
  if (!role) {
    return deny('unknown_user', 'You are not authorised to use the CEO agent.');
  }

  if (context.isSlackConnect && !workspace.allowSlackConnect) {
    return deny('slack_connect_denied', 'The CEO agent does not operate in Slack Connect conversations.');
  }

  let channelPolicy = context.channelPolicy;
  if (context.surface === 'channel') {
    if (!context.channelId) {
      return deny('unknown_channel', 'This conversation is not authorised.');
    }
    const configured = findChannelPolicy(workspace, context.channelId);
    if (!configured) {
      return deny('unknown_channel', 'The CEO agent is not enabled in this channel.');
    }
    channelPolicy = configured;
  }

  // Re-derive rather than trust: role and channelPolicy now come from our config.
  return { ok: true, context: { ...context, role, channelPolicy } };
}

export interface ToolAuthorizationInput {
  context: RequestContext;
  descriptor: ToolDescriptor;
  /** Canonical sha256 of the arguments actually about to be executed. */
  argumentsHash: string;
  approval?: { request: ApprovalRequest; decision: ApprovalDecision };
  /** Injected so the function stays pure and testable. */
  now: Date;
}

export interface AllowedCall {
  ok: true;
  /** True when the call is released by a recorded approval rather than by tier. */
  viaApproval: boolean;
}
export interface NeedsApproval {
  ok: false;
  reason: 'approval_required';
  eligibleApproverRoles: readonly string[];
  message: string;
}
export type ToolAuthorizationResult = AllowedCall | NeedsApproval | Denied;

/**
 * Gate 2: may this exact call proceed?
 *
 * The order matters. Surface and role are checked before approval, so an approval
 * can never be used to smuggle a tier-3 tool into an external channel — approval
 * releases a gated action, it does not widen where the action is legal.
 */
export function authorizeTool(
  policy: AccessPolicy,
  input: ToolAuthorizationInput,
): ToolAuthorizationResult {
  const { context, descriptor, argumentsHash, approval, now } = input;

  const admission = admitRequest(policy, context);
  if (!admission.ok) return admission;
  const ctx = admission.context;

  if (!descriptor.allowedSurfaces.includes(ctx.surface)) {
    return deny(
      'surface_not_allowed_for_tool',
      `${descriptor.id} cannot be used from a ${ctx.surface} conversation.`,
    );
  }

  // An external channel is read-only, full stop — no role and no approval lifts it.
  const isWrite = descriptor.tier !== 'tier0_read';
  if (ctx.channelPolicy === 'external' && isWrite) {
    return deny(
      'external_channel_write_denied',
      'Write actions are never performed from externally-shared conversations.',
    );
  }

  if (!INVOKER_ROLES[descriptor.tier].includes(ctx.role)) {
    return deny('role_may_not_invoke', `Your role cannot invoke ${descriptor.tier} actions.`);
  }

  if (!requiresApproval(descriptor)) {
    return { ok: true, viaApproval: false };
  }

  const eligible = APPROVER_ROLES[descriptor.tier];
  if (!approval) {
    return {
      ok: false,
      reason: 'approval_required',
      eligibleApproverRoles: eligible,
      message: `${descriptor.summary} needs approval from: ${eligible.join(' or ')}.`,
    };
  }

  const { request, decision } = approval;

  if (decision.state !== 'approved') {
    return deny('approval_not_approved', `This action was not approved (${decision.state}).`);
  }
  if (request.approvalId !== decision.approvalId) {
    return deny('approval_arguments_mismatch', 'Approval record does not match this action.');
  }
  // The core replay defence: the approved arguments must be the executed arguments.
  if (request.argumentsHash !== argumentsHash) {
    return deny(
      'approval_arguments_mismatch',
      'The action changed after it was approved. Re-request approval.',
    );
  }
  if (request.toolId !== descriptor.id) {
    return deny('approval_arguments_mismatch', 'Approval was issued for a different tool.');
  }
  if (new Date(request.expiresAt).getTime() <= now.getTime()) {
    return deny('approval_expired', 'That approval has expired. Please re-request it.');
  }
  if (!decision.decidedByRole || !eligible.includes(decision.decidedByRole)) {
    return deny('approver_role_insufficient', 'The approver does not hold a sufficient role.');
  }
  // A principal cannot release their own gated action.
  if (decision.decidedBy === request.requestedBy) {
    return deny('self_approval_denied', 'Gated actions require a second person to approve.');
  }

  return { ok: true, viaApproval: true };
}
