import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { AccessPolicySchema, type AccessPolicy, EMPTY_POLICY, InMemoryIdempotencyStore } from '@ceo/policy';
import { buildAllAgents } from '@ceo/agents';
import { InMemoryMemoryStore } from '@ceo/memory';
import { buildWorkflows } from '@ceo/workflows';
import { SkillRegistry } from '@ceo/skills';
import { loadEnv, type Env } from '@ceo/platform-config';
import { InMemoryExecutiveStore } from '@ceo/platform-db';
import { InMemoryApprovalStore, TurnRuntimeHolder } from '@ceo/platform-mastra';
import { ConsoleLogger, InMemoryAuditSink, type Logger } from '@ceo/platform-observability';

/**
 * Composition root.
 *
 * Every concrete dependency is chosen exactly once, here. Nothing below this file
 * constructs a store or reads an environment variable, which is what lets the eval
 * harness swap in-memory implementations without touching a single agent or
 * workflow.
 */

export interface Composition {
  env: Env;
  logger: Logger;
  policy: AccessPolicy;
  holder: TurnRuntimeHolder;
  agents: ReturnType<typeof buildAllAgents>;
  workflows: ReturnType<typeof buildWorkflows>;
  skills: SkillRegistry;
  audit: InMemoryAuditSink;
  approvals: InMemoryApprovalStore;
  idempotency: InMemoryIdempotencyStore;
  store: InMemoryExecutiveStore;
  memory: InMemoryMemoryStore;
}

/**
 * Loads the access policy from disk.
 *
 * A missing or malformed policy file yields the *empty* policy, which denies
 * everything. Failing open here would mean a typo in a path silently grants the
 * whole workspace access to the CEO's agent.
 */
/**
 * Resolves a relative config path against the workspace root rather than `cwd`.
 *
 * `mastra dev` and `mastra build` run from the bundle directory, so a plain
 * relative path silently misses. Because the policy loader fails closed, that
 * showed up as "every request denied" — correct, but a confusing default. Anchor
 * to the directory holding the workspace `package.json` instead.
 */
function resolveFromWorkspaceRoot(path: string): string {
  if (isAbsolute(path)) return path;

  let dir = dirname(new URL(import.meta.url).pathname);
  for (let depth = 0; depth < 10; depth++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return resolve(dir, path);
      } catch {
        // Unreadable package.json — keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), path);
}

export function loadAccessPolicy(rawPath: string, logger?: Pick<Logger, 'warn'>): AccessPolicy {
  const path = resolveFromWorkspaceRoot(rawPath);
  try {
    const parsed = AccessPolicySchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) {
      logger?.warn('access policy failed validation — denying all access', {
        path,
        issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      });
      return EMPTY_POLICY;
    }
    return parsed.data;
  } catch (error) {
    logger?.warn('access policy could not be read — denying all access', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_POLICY;
  }
}

export function compose(overrides: Record<string, string | undefined> = {}): Composition {
  const env = loadEnv(overrides);
  const logger = new ConsoleLogger(env.NODE_ENV === 'production' ? 'info' : 'debug', {
    service: 'ceo-runtime',
  });

  const policy = loadAccessPolicy(env.CEO_ACCESS_POLICY_PATH, logger);
  const audit = new InMemoryAuditSink();
  const approvals = new InMemoryApprovalStore();
  const idempotency = new InMemoryIdempotencyStore();
  const store = new InMemoryExecutiveStore();
  const memory = new InMemoryMemoryStore();

  const holder = new TurnRuntimeHolder({ policy, audit, logger, approvals });

  const agents = buildAllAgents({
    env,
    getRuntime: () => holder.current(),
    store,
    memory,
  });

  const workflows = buildWorkflows({ store, memory });

  return {
    env, logger, policy, holder, agents, workflows,
    skills: new SkillRegistry(),
    audit, approvals, idempotency, store, memory,
  };
}
