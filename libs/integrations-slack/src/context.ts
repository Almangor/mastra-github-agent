import { randomUUID } from 'node:crypto';

import {
  type RequestContext,
  RequestContextSchema,
  type Surface,
  deriveMemoryResourceId,
} from '@ceo/contracts';

/**
 * Turning a Slack event into a RequestContext (plan §1).
 *
 * The important discipline here: this function assigns the *shape* of the turn
 * (which surface, which memory partition, which thread) but deliberately assigns
 * the weakest possible role. @ceo/policy re-derives the real role from our own
 * config in `admitRequest`. If this function guessed the role, a Slack payload
 * would be an authorization input, which is exactly what plan §1 forbids.
 */

export interface SlackEventEnvelope {
  /** Slack's per-delivery event id, used for dedup. */
  eventId: string;
  teamId: string;
  userId: string;
  /** Absent for DMs with the app. */
  channelId?: string;
  /** Slack channel type: `im` for DM, `channel`/`group` otherwise. */
  channelType?: 'im' | 'channel' | 'group' | 'mpim';
  threadTs?: string;
  text: string;
  /** True when the conversation is shared externally (Slack Connect). */
  isExternalShared?: boolean;
  /** Slack sets this header on retried deliveries. */
  retryNum?: number;
}

export function surfaceFor(envelope: SlackEventEnvelope): Surface {
  return envelope.channelType === 'im' || !envelope.channelId ? 'dm' : 'channel';
}

export function buildRequestContext(
  envelope: SlackEventEnvelope,
  options: { now?: Date; requestId?: string } = {},
): RequestContext {
  const { now = new Date(), requestId = randomUUID() } = options;
  const surface = surfaceFor(envelope);
  const channelId = surface === 'dm' ? undefined : envelope.channelId;

  return RequestContextSchema.parse({
    requestId,
    workspaceId: envelope.teamId,
    userId: envelope.userId,
    // Weakest role. Overwritten by admitRequest from our own allowlist.
    role: 'observer',
    surface,
    channelId,
    threadId: envelope.threadTs,
    // Likewise provisional: an external classification here only ever tightens.
    channelPolicy: envelope.isExternalShared ? 'external' : 'restricted',
    isSlackConnect: Boolean(envelope.isExternalShared),
    memoryResourceId: deriveMemoryResourceId({
      workspaceId: envelope.teamId,
      surface,
      userId: envelope.userId,
      channelId,
      threadId: envelope.threadTs,
    }),
    eventId: envelope.eventId,
    receivedAt: now.toISOString(),
    isRedelivery: (envelope.retryNum ?? 0) > 0,
  });
}
