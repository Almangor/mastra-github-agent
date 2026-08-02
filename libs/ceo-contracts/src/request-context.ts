import { z } from 'zod';

/**
 * RequestContext — the identity and scope envelope that accompanies every turn.
 *
 * Plan §1: "Slack is the control plane, not the authorization system." Slack tells
 * us *who is speaking and where*; it does not tell us what they may do. This type
 * is the boundary between those two questions: the Slack adapter fills it in, and
 * @ceo/policy is the only thing allowed to turn it into a decision.
 *
 * Every field here is load-bearing for an authorization or isolation check, which
 * is why the schema is strict — an unrecognised field is a bug, not a passthrough.
 */

/** Where the conversation is happening. Drives memory isolation, not permission. */
export const SurfaceSchema = z.enum([
  /** 1:1 DM with the bot. Private executive work. */
  'dm',
  /** Public or private channel the bot was mentioned in. Thread-local memory. */
  'channel',
  /** Scheduled/durable execution with no human in the loop. */
  'scheduled',
  /** Operator CLI. Highest trust, still audited. */
  'admin_cli',
]);
export type Surface = z.infer<typeof SurfaceSchema>;

/**
 * Roles are assigned in our own policy config, never read from Slack.
 * A Slack workspace admin is not a CEO-agent principal.
 */
export const RoleSchema = z.enum([
  /** Full read; may approve tier-3 actions. */
  'ceo',
  /** Full read; may approve tier-2 actions within their function. */
  'exec',
  /** Scoped read; may request but not approve writes. */
  'staff',
  /** Read-only, redacted. Used for shared channels. */
  'observer',
  /** Machine principal for scheduled runs. Cannot approve anything. */
  'system',
]);
export type Role = z.infer<typeof RoleSchema>;

export const ChannelPolicySchema = z.enum([
  /** Channel is on the allowlist and members are trusted. */
  'trusted',
  /** Channel is allowlisted but may contain guests: redact and never write. */
  'restricted',
  /** Slack Connect / external. Denied by default (plan §1). */
  'external',
]);
export type ChannelPolicy = z.infer<typeof ChannelPolicySchema>;

export const RequestContextSchema = z
  .object({
    /** Stable id for this turn. Used for dedup and as the audit correlation key. */
    requestId: z.string().min(1),

    /** Slack workspace (team) id. Multi-tenant isolation starts here. */
    workspaceId: z.string().min(1),

    /** Slack user id of the speaker. */
    userId: z.string().min(1),

    /** Resolved from our own config — NOT from Slack group membership. */
    role: RoleSchema,

    surface: SurfaceSchema,

    /** Absent for DMs and scheduled runs. */
    channelId: z.string().min(1).optional(),

    /** Slack thread timestamp. Scopes thread-local memory in channels. */
    threadId: z.string().min(1).optional(),

    channelPolicy: ChannelPolicySchema,

    /**
     * True when the channel is shared with an external organisation.
     * Plan §1: Slack Connect is denied by default.
     */
    isSlackConnect: z.boolean().default(false),

    /**
     * Memory partition key. Derived, never supplied by the caller — see
     * `deriveMemoryResourceId`. DMs and channels must never share a partition.
     */
    memoryResourceId: z.string().min(1),

    /** Slack event id, for idempotent processing of retried deliveries. */
    eventId: z.string().min(1).optional(),

    /** Wall-clock receipt time, ISO 8601. Injected, never model-supplied. */
    receivedAt: z.string().datetime(),

    /** Set when the turn is a replay of an already-processed event. */
    isRedelivery: z.boolean().default(false),
  })
  .strict()
  .superRefine((ctx, issue) => {
    if (ctx.surface === 'channel' && !ctx.channelId) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['channelId'],
        message: 'channelId is required on the channel surface',
      });
    }
    if (ctx.surface === 'dm' && ctx.channelId) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['channelId'],
        message: 'a DM context must not carry a channelId — it would leak the memory partition',
      });
    }
    if (ctx.isSlackConnect && ctx.channelPolicy !== 'external') {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['channelPolicy'],
        message: 'Slack Connect conversations must be classified as external',
      });
    }
    if (ctx.surface === 'scheduled' && ctx.role !== 'system') {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role'],
        message: 'scheduled runs must use the system role so they cannot self-approve',
      });
    }
  });

export type RequestContext = z.infer<typeof RequestContextSchema>;

/**
 * Derives the memory partition key.
 *
 * Plan §1 requires different memory resources for DMs and shared channels. Getting
 * this wrong is the "DM-to-channel leakage" failure the eval gates test for, so the
 * derivation lives here — one implementation, used by every caller — rather than
 * being reconstructed at each call site.
 */
export function deriveMemoryResourceId(input: {
  workspaceId: string;
  surface: Surface;
  userId: string;
  channelId?: string;
  threadId?: string;
}): string {
  const { workspaceId, surface, userId, channelId, threadId } = input;
  switch (surface) {
    case 'dm':
      // Private to one person. Never readable from a channel turn.
      return `ws:${workspaceId}|dm:${userId}`;
    case 'channel': {
      if (!channelId) throw new Error('channel surface requires channelId to derive a memory resource');
      // Thread-local: a thread is the unit of shared context, not the channel.
      return threadId
        ? `ws:${workspaceId}|ch:${channelId}|th:${threadId}`
        : `ws:${workspaceId}|ch:${channelId}`;
    }
    case 'scheduled':
      return `ws:${workspaceId}|scheduled`;
    case 'admin_cli':
      return `ws:${workspaceId}|admin:${userId}`;
  }
}
