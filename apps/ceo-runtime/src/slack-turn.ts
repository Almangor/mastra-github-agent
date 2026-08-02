import { admitRequest, dedupKey, redactSecrets, runOnce, shouldRedactForAudience } from '@ceo/policy';
import {
  buildRequestContext,
  renderApprovalCard,
  type SlackEventEnvelope,
  verifySlackRequest,
} from '@ceo/integrations-slack';

import type { Composition } from './composition.ts';

/**
 * The inbound Slack turn (plan §1).
 *
 * The order below is the whole security design, and it is deliberately explicit
 * rather than spread across middleware:
 *
 *   1. verify signature        — an unsigned request is not a request
 *   2. acknowledge immediately — Slack retries after 3s; ack before model work
 *   3. deduplicate             — a retry must not re-run a tier-2 write
 *   4. build context           — shape only; role is assigned in step 5
 *   5. admit                   — our allowlist decides who this principal is
 *   6. run the turn            — with identity installed in the tool runtime
 *   7. redact                  — audience-aware, and always secret-stripped
 */

export interface TurnOutput {
  status: 'ok' | 'denied' | 'duplicate' | 'unverified';
  text: string;
  /** Block Kit blocks for any approvals raised during the turn. */
  approvalBlocks?: unknown[];
}

export interface HandleTurnInput {
  composition: Composition;
  envelope: SlackEventEnvelope;
  /** Raw body + headers, for signature verification. */
  signature?: { rawBody: string; timestamp?: string; signature?: string };
  /** Injected so tests can drive the agent without a live model. */
  runAgent: (input: { prompt: string; agentId: string }) => Promise<string>;
  now?: Date;
}

export async function handleSlackTurn(input: HandleTurnInput): Promise<TurnOutput> {
  const { composition, envelope, signature, runAgent, now = new Date() } = input;
  const { env, policy, holder, audit, approvals, idempotency } = composition;

  // 1. Verify. Skipped only when no signing secret is configured (local dev),
  //    and that fact is worth being loud about.
  if (env.SLACK_SIGNING_SECRET) {
    if (!signature) return { status: 'unverified', text: 'Request could not be verified.' };
    const verification = verifySlackRequest({
      signingSecret: env.SLACK_SIGNING_SECRET,
      rawBody: signature.rawBody,
      timestampHeader: signature.timestamp,
      signatureHeader: signature.signature,
      now,
    });
    if (!verification.ok) {
      return { status: 'unverified', text: 'Request could not be verified.' };
    }
  }

  // 3. Deduplicate. (2 — the immediate ack — is the caller's job, since it must
  //    happen before this function is awaited.)
  const key = dedupKey({ workspaceId: envelope.teamId, eventId: envelope.eventId });

  const outcome = await runOnce(idempotency, key, async (): Promise<TurnOutput> => {
    // 4. Build the turn's shape.
    const context = buildRequestContext(envelope, { now });

    // 5. Admit. This is where the real role and channel policy are assigned.
    const admission = admitRequest(policy, context);
    if (!admission.ok) {
      return { status: 'denied', text: admission.message };
    }
    const admitted = admission.context;

    // 6. Run with identity installed, so every guarded tool sees this principal.
    const raw = await holder.withTurn({ context: admitted, agentId: 'ceoAgent' }, () =>
      runAgent({ prompt: envelope.text, agentId: 'ceoAgent' }),
    );

    // 7. Redact. Secrets always; executive detail according to the audience.
    const { text: secretsStripped, found } = redactSecrets(raw);
    if (found.length > 0) {
      // Redaction already saved us, but a model emitting credential-shaped text is
      // an incident in its own right — the adversarial gate reads this.
      composition.logger.error('agent output contained credential-shaped content', {
        requestId: admitted.requestId,
        patterns: found,
      });
    }

    const audience = shouldRedactForAudience(admitted);
    const text =
      audience === 'withhold'
        ? 'I do not discuss internal matters in externally-shared conversations.'
        : secretsStripped;

    // Surface any approval cards this turn opened.
    const pending = await approvals.pending(admitted.workspaceId);
    const approvalBlocks = pending
      .filter(request => request.requestId === admitted.requestId)
      .flatMap(request => renderApprovalCard(request));

    void audit;
    return { status: 'ok', text, ...(approvalBlocks.length ? { approvalBlocks } : {}) };
  });

  if (!outcome.ran) {
    // A Slack redelivery. Answering "duplicate" is correct: the original turn is
    // either in flight or already answered in the thread.
    return { status: 'duplicate', text: '' };
  }
  return outcome.result;
}
