import { z } from 'zod';

/**
 * @ceo/platform-config — validated environment configuration.
 *
 * Config is parsed once, at process start, and fails loudly. The alternative —
 * `process.env.X!` sprinkled through the codebase — means a missing Slack secret
 * surfaces as an authorization bug three layers deep at 2am.
 */

const Booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform(v => v === 'true' || v === '1');

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Required: the agent cannot run without a model. */
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),

  /** Model routing. Defaults chosen in ADR-0004. */
  CEO_SUPERVISOR_MODEL: z.string().default('claude-opus-5'),
  CEO_SUBAGENT_MODEL: z.string().default('claude-sonnet-5'),
  CEO_REVIEWER_MODEL: z.string().default('claude-sonnet-5'),

  /** Executive-state store. `file:` for local, libsql/turso URL in production. */
  CEO_DB_URL: z.string().default('file:./ceo-state.db'),

  // --- Slack control plane (optional in dev; required to serve Slack) --------
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  /** Path to the access-policy JSON that @ceo/policy consumes. */
  CEO_ACCESS_POLICY_PATH: z.string().default('./config/access-policy.json'),

  // --- Integrations (all optional; absence degrades to a disabled adapter) ---
  GITHUB_TOKEN: z.string().optional(),
  LINEAR_API_KEY: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  CRM_API_KEY: z.string().optional(),
  FINANCE_API_KEY: z.string().optional(),

  // --- Durability -----------------------------------------------------------
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  // --- Learning safety switches --------------------------------------------
  /** Master switch for the learning pipeline. Off unless deliberately enabled. */
  CEO_LEARNING_ENABLED: Booleanish.default('false'),
  /** Percentage of traffic a canary skill may see. Plan §3 caps this. */
  CEO_CANARY_TRAFFIC_PERCENT: z.coerce.number().min(0).max(25).default(10),

  /** Feature-flagged betas the plan explicitly keeps off the critical path. */
  CEO_ENABLE_AGENT_CONTROLLER: Booleanish.default('false'),
  CEO_ENABLE_MASTRA_GOALS: Booleanish.default('false'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * Parses and caches the environment.
 *
 * `overrides` exists so tests and the eval harness can construct a config without
 * mutating `process.env`, which would leak between cases.
 */
export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const detail = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  if (Object.keys(overrides).length === 0) cached = parsed.data;
  return parsed.data;
}

/** True when an integration has the credentials it needs to do real work. */
export function integrationEnabled(env: Env, name: 'github' | 'linear' | 'google' | 'crm' | 'finance'): boolean {
  switch (name) {
    case 'github':
      return Boolean(env.GITHUB_TOKEN);
    case 'linear':
      return Boolean(env.LINEAR_API_KEY);
    case 'google':
      return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    case 'crm':
      return Boolean(env.CRM_API_KEY);
    case 'finance':
      return Boolean(env.FINANCE_API_KEY);
  }
}
