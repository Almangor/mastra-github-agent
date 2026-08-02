import { createHash } from 'node:crypto';

import { createTool } from '@mastra/core/tools';
import type { z } from 'zod';

import {
  type ApprovalDecision,
  type ApprovalRequest,
  type RequestContext,
  type ToolDescriptor,
  ToolDescriptorSchema,
  requiresApproval,
} from '@ceo/contracts';
import { type AccessPolicy, authorizeTool, redactSecrets } from '@ceo/policy';
import { type AuditSink, buildAuditEvent, type Logger } from '@ceo/platform-observability';

/**
 * The guarded business-tool factory (plan: "typed, approval-gated business tools").
 *
 * This is the enforcement point. Every tool that touches a real system is built
 * here, which means the authorization check is not something an agent author can
 * forget to add — it is inside the only constructor available to them.
 *
 * The design that makes this hold up: the risk tier and the descriptor live in
 * *code*, the RequestContext is injected by the runtime, and neither travels
 * through the model. A prompt injection can choose which tool to call and with
 * what arguments; it cannot change who is asking or what the tool is allowed to do.
 */

/** Everything the guard needs, supplied by the runtime — never by the model. */
export interface ToolRuntime {
  policy: AccessPolicy;
  context: RequestContext;
  audit: AuditSink;
  logger: Logger;
  agentId: string;
  /**
   * Looks up an existing approval for this exact call. Returns undefined when the
   * action has not been released yet.
   */
  findApproval(input: {
    toolId: string;
    argumentsHash: string;
  }): Promise<{ request: ApprovalRequest; decision: ApprovalDecision } | undefined>;
  /**
   * Opens an approval card and returns its id. The turn then stops: the agent
   * reports that approval is pending rather than blocking on a human.
   */
  requestApproval(input: {
    descriptor: ToolDescriptor;
    argumentsHash: string;
    renderedSummary: string;
  }): Promise<ApprovalRequest>;
  now(): Date;
}

/**
 * Canonical argument hashing.
 *
 * Object key order must not change the hash, or an approval would be trivially
 * bypassable by re-serialising the same arguments in a different order.
 */
export function hashArguments(args: unknown): string {
  return createHash('sha256').update(canonicalise(args)).digest('hex');
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}

/** Returned to the model when a call is blocked. Deliberately actionable. */
export interface GuardBlocked {
  status: 'denied' | 'approval_pending';
  message: string;
  approvalId?: string;
}

export interface DefineBusinessToolOptions<TInput extends z.ZodTypeAny> {
  descriptor: ToolDescriptor;
  description: string;
  inputSchema: TInput;
  /** The real effect. Only ever reached after the guard allows the call. */
  execute: (args: z.infer<TInput>, runtime: ToolRuntime) => Promise<unknown>;
  /**
   * One line describing what *these specific arguments* will do, shown on the
   * approval card. "Create issue ENG-142 in Platform" beats "run linear.createIssue".
   */
  renderSummary?: (args: z.infer<TInput>) => string;
}

/**
 * Builds a Mastra tool whose execute path is wrapped in the policy check.
 *
 * `getRuntime` is a thunk because a tool definition is constructed once at module
 * load but must read the *current* turn's context on every call.
 */
export function defineBusinessTool<TInput extends z.ZodTypeAny>(
  options: DefineBusinessToolOptions<TInput>,
  getRuntime: () => ToolRuntime,
): GuardedTool {
  const descriptor = ToolDescriptorSchema.parse(options.descriptor);

  const tool = createTool({
    id: descriptor.id,
    description: options.description,
    inputSchema: options.inputSchema,
    execute: async (rawArgs: z.infer<TInput>) => {
      const runtime = getRuntime();
      const args = options.inputSchema.parse(rawArgs) as z.infer<TInput>;
      const argumentsHash = hashArguments(args);
      const renderedSummary = options.renderSummary?.(args) ?? descriptor.summary;

      const audit = (
        outcome: 'allowed' | 'denied' | 'requires_approval' | 'error',
        extra: { reason?: string; approvalId?: string } = {},
      ) =>
        runtime.audit.record(
          buildAuditEvent({
            context: runtime.context,
            agentId: runtime.agentId,
            toolId: descriptor.id,
            tier: descriptor.tier,
            outcome,
            // The summary is redacted because arguments can contain secrets.
            redactedSummary: redactSecrets(renderedSummary).text,
            argumentsHash,
            now: runtime.now(),
            ...extra,
          }),
        );

      const approval = requiresApproval(descriptor)
        ? await runtime.findApproval({ toolId: descriptor.id, argumentsHash })
        : undefined;

      const decision = authorizeTool(runtime.policy, {
        context: runtime.context,
        descriptor,
        argumentsHash,
        approval,
        now: runtime.now(),
      });

      if (!decision.ok && decision.reason === 'approval_required') {
        const request = await runtime.requestApproval({ descriptor, argumentsHash, renderedSummary });
        await audit('requires_approval', { approvalId: request.approvalId });
        runtime.logger.info('tool call gated pending approval', {
          toolId: descriptor.id,
          approvalId: request.approvalId,
        });
        return {
          status: 'approval_pending',
          approvalId: request.approvalId,
          message: `${renderedSummary} — sent for approval. I will not proceed until it is released.`,
        } satisfies GuardBlocked;
      }

      if (!decision.ok) {
        await audit('denied', { reason: decision.reason });
        runtime.logger.warn('tool call denied', { toolId: descriptor.id, reason: decision.reason });
        return { status: 'denied', message: decision.message } satisfies GuardBlocked;
      }

      await audit('allowed', { approvalId: approval?.request.approvalId });
      try {
        return await options.execute(args, runtime);
      } catch (error) {
        await audit('error', { reason: 'execution_failed' });
        runtime.logger.error('tool execution failed', {
          toolId: descriptor.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Surface the failure to the model so it can adapt rather than retry blindly.
        return {
          status: 'error',
          message: `${descriptor.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });

  // The descriptor rides along on the tool so agent construction can enforce a
  // per-agent tier ceiling without a second, drift-prone registry of tool metadata.
  return Object.assign(tool, { __descriptor: descriptor }) as GuardedTool;
}

/** A Mastra tool that carries its risk descriptor for build-time boundary checks. */
export type GuardedTool = ReturnType<typeof createTool> & { __descriptor: ToolDescriptor };

export function descriptorOf(tool: unknown): ToolDescriptor | undefined {
  return (tool as { __descriptor?: ToolDescriptor })?.__descriptor;
}
