/**
 * Operator CLI (plan §5: apps/ceo-admin).
 *
 * The human side of the governance model: inspect the effective access policy,
 * release or deny pending approvals, and drive skill curation. Everything here
 * goes through the same contracts the runtime uses — there is no admin back door
 * that skips the transition table or the approval rules.
 *
 *   npm run admin policy
 *   npm run admin approvals
 *   npm run admin skills
 *   npm run admin gates
 */
import 'dotenv/config';

import { APPROVER_ROLES, INVOKER_ROLES, RISK_TIER_ORDER, TRANSITIONS } from '@ceo/contracts';
import { SPECIALISTS, allSpecialistToolIds } from '@ceo/agents';
import { planCuration } from '@ceo/skills';
import { DURABLE_JOBS } from '@ceo/platform-inngest';
import { datasetStats, emptyEvidence, runGates } from '@ceo/eval-kit';

import { compose } from '@ceo/runtime';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const composition = compose();

function showPolicy(): void {
  console.log(`\n${bold('Effective access policy')} ${dim(`(${composition.env.CEO_ACCESS_POLICY_PATH})`)}\n`);
  if (composition.policy.workspaces.length === 0) {
    console.log(`  ${red('No workspaces configured — every request is denied.')}\n`);
    return;
  }
  for (const workspace of composition.policy.workspaces) {
    console.log(`  ${bold(workspace.workspaceId)} ${dim(workspace.label ?? '')}`);
    console.log(`    Slack Connect: ${workspace.allowSlackConnect ? red('ALLOWED') : green('denied')}`);
    for (const user of workspace.users) console.log(`    user    ${user.userId.padEnd(18)} ${user.role}`);
    for (const channel of workspace.channels) console.log(`    channel ${channel.channelId.padEnd(18)} ${channel.policy}`);
  }

  console.log(`\n${bold('Tool-risk tiers')}\n`);
  for (const tier of RISK_TIER_ORDER) {
    const approvers = APPROVER_ROLES[tier];
    console.log(`  ${tier.padEnd(22)} invoke: ${INVOKER_ROLES[tier].join(',').padEnd(30)} approve: ${approvers.length ? approvers.join(',') : dim('n/a (ungated)')}`);
  }
  console.log();
}

async function showApprovals(): Promise<void> {
  console.log(`\n${bold('Pending approvals')}\n`);
  let total = 0;
  for (const workspace of composition.policy.workspaces) {
    const pending = await composition.approvals.pending(workspace.workspaceId);
    total += pending.length;
    for (const request of pending) {
      console.log(`  ${request.approvalId}  ${request.tier}  ${request.summary}`);
      console.log(`  ${dim(`requested by ${request.requestedBy}, expires ${request.expiresAt}, approvable by ${request.eligibleApproverRoles.join('/')}`)}`);
    }
  }
  if (total === 0) console.log(dim('  none\n'));
}

function showSkills(): void {
  console.log(`\n${bold('Skill registry')}\n`);
  const skills = composition.skills.all();
  if (skills.length === 0) {
    console.log(dim('  no skills registered — the learning pipeline has not proposed anything yet\n'));
  } else {
    for (const skill of skills) {
      console.log(`  ${skill.id}@${skill.version}  ${skill.state.padEnd(18)} loads=${skill.usage.loadCount}`);
    }
    const plan = planCuration(composition.skills);
    console.log(`\n  curation plan: ${plan.length} transition(s)`);
    for (const item of plan) console.log(`    ${item.id}@${item.version} → ${item.to} (${item.reason})`);
  }

  console.log(`\n${bold('Who may drive a skill transition')}  ${dim('— the reviewer appears only on proposal edges')}\n`);
  for (const [from, edges] of Object.entries(TRANSITIONS)) {
    if (edges.length === 0) continue;
    for (const edge of edges) {
      const reviewer = edge.by.includes('learning_reviewer');
      console.log(`  ${reviewer ? '•' : ' '} ${from.padEnd(18)} → ${edge.to.padEnd(18)} ${dim(edge.by.join(', '))}`);
    }
  }
  console.log();
}

function showGates(): void {
  // With no run evidence every gate passes vacuously; this view is for confirming
  // the gate set itself is wired, and for showing the dataset shape.
  const { results } = runGates(emptyEvidence());
  console.log(`\n${bold('Release gates')}\n`);
  for (const gate of results) console.log(`  ${gate.passed ? green('✓') : red('✗')} ${gate.id} ${gate.name}`);

  const stats = datasetStats();
  console.log(`\n${bold('Eval dataset')} ${dim(stats.version)}\n`);
  console.log(`  ${stats.total} cases · ${stats.executable} executable · ${stats.modelDependent} model-dependent · ${stats.gates} gate cases`);
  for (const [suite, count] of Object.entries(stats.bySuite)) console.log(`    ${suite.padEnd(16)} ${count}`);

  console.log(`\n${bold('Agents')}\n`);
  console.log(`  supervisor + ${SPECIALISTS.length} specialists · ${allSpecialistToolIds().length} distinct specialist tools (all read-only)`);
  console.log(`  ${DURABLE_JOBS.length} durable jobs · ${composition.workflows.length} workflows\n`);
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'gates';
  switch (command) {
    case 'policy': showPolicy(); return 0;
    case 'approvals': await showApprovals(); return 0;
    case 'skills': showSkills(); return 0;
    case 'gates': showGates(); return 0;
    default:
      console.error(`Unknown command "${command}". Try: policy | approvals | skills | gates`);
      return 1;
  }
}

main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
