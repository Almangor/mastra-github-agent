import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Slack request verification.
 *
 * This runs before anything else — before dedup, before policy, before the model.
 * An unverified request is not a low-privilege request; it is not a request at all,
 * because anyone can post JSON claiming to be any user in any workspace.
 */

export const SLACK_SIGNATURE_VERSION = 'v0';
/** Slack's own guidance: reject anything older than five minutes. */
export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'stale_timestamp' | 'bad_signature' };

export function verifySlackRequest(input: {
  signingSecret: string;
  /** The exact raw body bytes. Re-serialised JSON will not match. */
  rawBody: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  now?: Date;
}): VerificationResult {
  const { signingSecret, rawBody, timestampHeader, signatureHeader, now = new Date() } = input;

  if (!timestampHeader || !signatureHeader) return { ok: false, reason: 'missing_headers' };

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'missing_headers' };

  // Replay defence: an attacker who captures a valid signed body cannot use it later.
  if (Math.abs(now.getTime() - timestamp * 1000) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac('sha256', signingSecret)
    .update(`${SLACK_SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`)
    .digest('hex')}`;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  return { ok: true };
}
