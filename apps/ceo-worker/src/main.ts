/**
 * Durable worker (plan §2).
 *
 * Owns the scheduled, restart-safe half of the system. The workflow definitions
 * themselves live in @ceo/workflows and know nothing about this process — this
 * file only decides *when* they run and what happens when one suspends.
 *
 *   npm run worker            # list the schedule and exit
 *   npm run worker -- --run daily-briefing
 */
import 'dotenv/config';

import { DURABLE_JOBS } from '@ceo/platform-inngest';
import { runWorkflow } from '@ceo/workflows';
import { RequestContextSchema, deriveMemoryResourceId } from '@ceo/contracts';

import { compose } from '@ceo/runtime';

const composition = compose();

/** Scheduled runs get the `system` role, which cannot approve anything. */
function scheduledContext(workspaceId: string, now: Date) {
  return RequestContextSchema.parse({
    requestId: `sched_${now.getTime()}`,
    workspaceId,
    userId: 'system',
    role: 'system',
    surface: 'scheduled',
    channelPolicy: 'trusted',
    isSlackConnect: false,
    memoryResourceId: deriveMemoryResourceId({ workspaceId, surface: 'scheduled', userId: 'system' }),
    receivedAt: now.toISOString(),
    isRedelivery: false,
  });
}

async function runJob(workflowId: string, seed: Record<string, unknown> = {}): Promise<number> {
  const workflow = composition.workflows.find(w => w.id === workflowId);
  if (!workflow) {
    console.error(`No workflow "${workflowId}". Known: ${composition.workflows.map(w => w.id).join(', ')}`);
    return 1;
  }

  const workspaceId = composition.policy.workspaces[0]?.workspaceId;
  if (!workspaceId) {
    console.error('No workspace configured in the access policy — nothing to run against.');
    return 1;
  }

  const now = new Date();
  const result = await runWorkflow(workflow, {
    request: scheduledContext(workspaceId, now),
    now,
    // Seed state lands under `input`, which is where the process steps look for
    // their arguments — decision-memo reads `input.question`, incident-mode reads
    // `input.description`. Without this a process that needs an argument can only
    // ever fail from the CLI.
    ...(Object.keys(seed).length > 0 ? { resumeState: { input: seed } } : {}),
  });

  console.log(JSON.stringify({ workflowId, status: result.status, awaiting: result.awaiting, trace: result.trace }, null, 2));

  // A suspended run is a normal outcome, not a failure: it is waiting on a human.
  // Only a genuine failure should page anyone.
  return result.status === 'failed' ? 1 : 0;
}

async function main(): Promise<number> {
  const runIndex = process.argv.indexOf('--run');
  if (runIndex !== -1) {
    const id = process.argv[runIndex + 1];
    if (!id) { console.error('--run needs a workflow id'); return 1; }

    const inputIndex = process.argv.indexOf('--input');
    let seed: Record<string, unknown> = {};
    if (inputIndex !== -1) {
      const raw = process.argv[inputIndex + 1];
      if (!raw) { console.error('--input needs a JSON object'); return 1; }
      try {
        seed = JSON.parse(raw) as Record<string, unknown>;
      } catch (error) {
        console.error(`--input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
      }
    }
    return runJob(id, seed);
  }

  console.log('\nDurable job schedule (plan §2 — Inngest owns scheduled, restart-safe work)\n');
  for (const job of DURABLE_JOBS) {
    const when = job.schedule ? `${job.schedule.expression} ${job.schedule.timezone}` : 'event-only';
    console.log(`  ${job.id.padEnd(28)} ${when.padEnd(28)} → ${job.workflowId}`);
    console.log(`  ${' '.repeat(28)} ${job.description}`);
  }
  console.log(`\n  ${DURABLE_JOBS.length} jobs · concurrency keyed per workspace`);
  console.log('  run one:  npm run worker -- --run <workflowId>');
  console.log(`  with input:  npm run worker -- --run decision-memo --input '{"question":"..."}'\n`);
  return 0;
}

main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
