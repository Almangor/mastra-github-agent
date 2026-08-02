import type { RequestContext } from '@ceo/contracts';

/**
 * Output redaction (plan §4 hard gate: "zero secret leakage in the adversarial
 * suite"; §1: restricted channels may contain guests).
 *
 * Two independent jobs:
 *   - `redactSecrets` strips credential-shaped strings from anything the agent is
 *     about to say. It runs on every surface, because a leaked token in a DM is
 *     still a leaked token.
 *   - `shouldRedactForAudience` decides whether *executive* content is
 *     appropriate for the audience at all.
 */

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

/**
 * Shapes, not values. Matching on shape catches secrets we have never seen, which
 * is the only useful property here — an allowlist of known secrets is always stale.
 */
const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'anthropic_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: 'openai_key', pattern: /\bsk-[A-Za-z0-9]{32,}/g },
  { name: 'slack_token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: 'slack_webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
  { name: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'aws_access_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'private_key_block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END [^-]*-----/g },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'bearer_header', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  { name: 'db_url_with_password', pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/g },
];

export interface RedactionResult {
  text: string;
  /** Which pattern names fired. Non-empty means an adversarial gate should trip. */
  found: string[];
}

export function redactSecrets(input: string): RedactionResult {
  let text = input;
  const found: string[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    // Fresh lastIndex per call — these are module-level /g regexes.
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      found.push(name);
      pattern.lastIndex = 0;
      text = text.replace(pattern, `[redacted:${name}]`);
    }
  }
  return { text, found };
}

export function containsSecret(input: string): boolean {
  return redactSecrets(input).found.length > 0;
}

/**
 * Whether executive detail should be withheld given where we are speaking.
 *
 * A `restricted` channel is allowlisted but may include guests, so the agent
 * summarises rather than quoting. An `external` channel gets nothing beyond an
 * acknowledgement.
 */
export function shouldRedactForAudience(context: RequestContext): 'none' | 'summarise' | 'withhold' {
  if (context.channelPolicy === 'external') return 'withhold';
  if (context.channelPolicy === 'restricted') return 'summarise';
  if (context.surface === 'channel' && context.role === 'observer') return 'summarise';
  return 'none';
}

/**
 * Cross-partition leak check (hard gate: "zero DM-to-channel leakage").
 *
 * Memory reads are keyed by `memoryResourceId`; this asserts the key a read used
 * matches the key the current turn is entitled to. Called by @ceo/memory on every
 * retrieval so a mis-scoped read fails loudly instead of quietly returning private
 * content into a channel.
 */
export function assertSameMemoryPartition(context: RequestContext, usedResourceId: string): void {
  if (usedResourceId !== context.memoryResourceId) {
    throw new Error(
      `memory partition violation: turn is scoped to "${context.memoryResourceId}" but a read used "${usedResourceId}"`,
    );
  }
}
