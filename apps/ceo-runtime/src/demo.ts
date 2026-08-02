/**
 * End-to-end demo of the Slack turn pipeline.
 *
 * Runs with a stub model by default, so the security and approval behaviour is
 * demonstrable with no API key and no Slack workspace. Pass --live to route the
 * turn through the real CEO agent (needs ANTHROPIC_API_KEY).
 *
 *   npm run demo
 *   npm run demo -- --live "What is our runway?"
 */
import 'dotenv/config';

import { hasModelCredentials } from '@ceo/platform-config';
import { buildApprovalRequest, hashArguments } from '@ceo/platform-mastra';

import { compose } from './composition.ts';
import { handleSlackTurn } from './slack-turn.ts';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// A workspace that mirrors config/access-policy.json but with ids the demo can use.
const DEMO_POLICY = {
  workspaces: [
    {
      workspaceId: 'T_DEMO',
      label: 'Demo workspace',
      allowSlackConnect: false,
      users: [
        { userId: 'U_CEO', role: 'ceo' as const, label: 'Chief Executive' },
        { userId: 'U_EXEC', role: 'exec' as const, label: 'VP Engineering' },
        { userId: 'U_STAFF', role: 'staff' as const, label: 'Chief of staff' },
      ],
      channels: [
        { channelId: 'C_EXEC', policy: 'trusted' as const, label: '#exec' },
        { channelId: 'C_PARTNER', policy: 'external' as const, label: '#partner (Slack Connect)' },
      ],
    },
  ],
};

const live = process.argv.includes('--live');

async function main(): Promise<void> {
  const composition = compose();

  // Fail here, with a sentence the reader can act on, rather than letting the
  // SDK surface a bare 401 three frames deep.
  if (live && !hasModelCredentials(composition.env)) {
    console.error(
      '\n--live needs a real ANTHROPIC_API_KEY.\n' +
        'Copy .env.example to .env and replace the sk-ant-... placeholder with a key\n' +
        'from https://console.anthropic.com/settings/keys — then re-run.\n',
    );
    process.exit(1);
  }
  // Swap in the demo policy so the walkthrough works out of the box.
  (composition as { policy: typeof DEMO_POLICY }).policy = DEMO_POLICY;
  (composition.holder as unknown as { deps: { policy: unknown } }).deps.policy = DEMO_POLICY;

  const stubAgent = async ({ prompt }: { prompt: string }) =>
    `[stub model] I would answer: "${prompt}". Run with --live and an ANTHROPIC_API_KEY for the real agent.`;

  const liveAgent = async ({ prompt, agentId }: { prompt: string; agentId: string }) => {
    const agents = composition.agents as Record<string, { generate: (p: string) => Promise<{ text: string }> }>;
    const agent = agents[agentId];
    if (!agent) throw new Error(`no agent "${agentId}" in the composition`);
    const result = await agent.generate(prompt);
    return result.text;
  };

  const runAgent = live ? liveAgent : stubAgent;

  const scenarios: { title: string; envelope: Parameters<typeof handleSlackTurn>[0]['envelope']; note: string }[] = [
    {
      title: 'CEO asks a question in a DM',
      note: 'Admitted: on the allowlist, DM surface, trusted.',
      envelope: { eventId: 'Ev001', teamId: 'T_DEMO', userId: 'U_CEO', channelType: 'im', text: process.argv.slice(2).filter(a => a !== '--live')[0] ?? 'What is our runway?' },
    },
    {
      title: 'Someone not on the allowlist asks the same question',
      note: 'Denied: Slack says they are a valid workspace member; our policy says they are nobody.',
      envelope: { eventId: 'Ev002', teamId: 'T_DEMO', userId: 'U_RANDOM', channelType: 'im', text: 'What is our runway?' },
    },
    {
      title: 'Slack redelivers the CEO event after a timeout',
      note: 'Suppressed: same event id, so the work does not run twice.',
      envelope: { eventId: 'Ev001', teamId: 'T_DEMO', userId: 'U_CEO', channelType: 'im', text: 'What is our runway?', retryNum: 1 },
    },
    {
      title: 'Question arrives in an externally-shared channel',
      note: 'Denied: Slack Connect is off by default.',
      envelope: { eventId: 'Ev003', teamId: 'T_DEMO', userId: 'U_CEO', channelId: 'C_PARTNER', channelType: 'channel', text: 'What is our runway?', isExternalShared: true },
    },
  ];

  console.log(`\n${bold('CEO agent — Slack turn pipeline')} ${dim(live ? '(live model)' : '(stub model)')}\n`);

  for (const scenario of scenarios) {
    const result = await handleSlackTurn({ composition, envelope: scenario.envelope, runAgent });
    const mark = result.status === 'ok' ? green('ok') : result.status === 'duplicate' ? dim('duplicate') : red(result.status);
    console.log(`  ${bold(scenario.title)}`);
    console.log(`    → ${mark}  ${result.text || dim('(no output — suppressed)')}`);
    console.log(`    ${dim(scenario.note)}\n`);
  }

  // Approval flow, shown against the real contract rather than described.
  console.log(`${bold('Gated write: approval card')}\n`);
  const args = { teamKey: 'ENG', title: 'Migrate billing worker', priority: 2 };
  const request = buildApprovalRequest({
    context: {
      requestId: 'req_demo', workspaceId: 'T_DEMO', userId: 'U_CEO', role: 'ceo', surface: 'dm',
      channelPolicy: 'trusted', isSlackConnect: false, memoryResourceId: 'ws:T_DEMO|dm:U_CEO',
      receivedAt: new Date().toISOString(), isRedelivery: false,
    },
    descriptor: {
      id: 'linear.createIssue', tier: 'tier2_business_write', summary: 'Create a Linear issue',
      system: 'linear', reversible: true, allowedSurfaces: ['dm', 'channel', 'scheduled'],
    },
    argumentsHash: hashArguments(args),
    renderedSummary: `Create Linear issue in ENG: "${args.title}" (priority ${args.priority})`,
    now: new Date(),
  });

  console.log(`    summary        ${request.summary}`);
  console.log(`    tier           ${request.tier}`);
  console.log(`    blast radius   ${request.blastRadius}`);
  console.log(`    approvable by  ${request.eligibleApproverRoles.join(' or ')} ${dim('(the requester cannot self-approve)')}`);
  console.log(`    args hash      ${request.argumentsHash.slice(0, 16)}… ${dim('(re-checked at release; a changed argument invalidates the approval)')}`);
  console.log();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
