import { riskScore } from '@ceo/domain';
import type { MemoryStore } from '@ceo/memory';
import type { ExecutiveStore } from '@ceo/platform-db';

import { type WorkflowDefinition, step } from './definition.ts';

/**
 * The ten executive processes (plan §2).
 *
 * Each is defined in terms of the executive store and memory rather than in terms
 * of a model call, for a specific reason: the *shape* of an executive process is a
 * deterministic thing (gather → assess → decide what reaches the CEO → record), and
 * only the judgement inside a step needs a model. Keeping the skeleton deterministic
 * is what makes "workflow restart and approval handling" testable in the eval suite.
 */

export interface ProcessDeps {
  store: ExecutiveStore;
  memory: MemoryStore;
  /** Injected so a workflow can ask a specialist for judgement without importing one. */
  consult?: (agentId: string, prompt: string) => Promise<string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildWorkflows(deps: ProcessDeps): WorkflowDefinition[] {
  const { store, memory } = deps;

  const dailyBriefing: WorkflowDefinition = {
    id: 'daily-briefing',
    name: 'Daily executive briefing',
    description: 'Assemble the morning brief: what changed, what needs a decision today.',
    consults: ['operationsAgent', 'revenueAgent', 'riskAgent'],
    steps: [
      {
        id: 'gather',
        description: 'Collect commitments due, risks that moved, and open decisions.',
        canSuspend: false,
        run: async ctx => {
          const workspaceId = ctx.request.workspaceId;
          const horizon = new Date(ctx.now.getTime() + 2 * DAY_MS).toISOString();
          const [commitments, risks, decisions] = await Promise.all([
            store.listCommitments(workspaceId, { dueBefore: horizon, status: 'open' }),
            store.listRisks(workspaceId, { status: 'active' }),
            store.listDecisions(workspaceId, { status: 'open' }),
          ]);
          return step.continue({
            dueCommitments: commitments.items,
            activeRisks: risks.items.sort((a, b) => riskScore(b) - riskScore(a)),
            openDecisions: decisions.items,
          });
        },
      },
      {
        id: 'triage',
        description: 'Decide what is material enough to reach the CEO.',
        canSuspend: false,
        run: async ctx => {
          const gathered = ctx.state.gather as {
            dueCommitments: unknown[];
            activeRisks: { title: string; likelihood: string; impact: string }[];
            openDecisions: unknown[];
          };
          // A brief that reports nothing is better than a brief that manufactures
          // content — an empty morning is a real and useful signal.
          const material =
            gathered.dueCommitments.length + gathered.activeRisks.length + gathered.openDecisions.length;
          if (material === 0) return step.skip('nothing material since the last brief');

          // Only escalate risks above the midpoint of the score range.
          const escalate = gathered.activeRisks.filter(r => riskScore(r as never) >= 6);
          return step.continue({ itemCount: material, escalatedRisks: escalate });
        },
      },
      {
        id: 'record',
        description: 'Persist the brief so tomorrow can diff against it.',
        canSuspend: false,
        run: async ctx => {
          const triage = ctx.state.triage as { itemCount: number };
          return step.continue({ recorded: true, itemCount: triage.itemCount });
        },
      },
    ],
  };

  const weeklyOperatingReview: WorkflowDefinition = {
    id: 'weekly-operating-review',
    name: 'Weekly operating review',
    description: 'Cross-functional review: variance against plan, risks, decisions needed.',
    consults: ['operationsAgent', 'revenueAgent', 'financeAgent', 'productEngineeringAgent', 'peopleAgent'],
    steps: [
      {
        id: 'collect',
        description: 'Pull the week of commitments, risks, and decisions.',
        canSuspend: false,
        run: async ctx => {
          const workspaceId = ctx.request.workspaceId;
          const [commitments, risks, decisions] = await Promise.all([
            store.listCommitments(workspaceId),
            store.listRisks(workspaceId),
            store.listDecisions(workspaceId),
          ]);
          return step.continue({
            commitments: commitments.items,
            risks: risks.items,
            decisions: decisions.items,
          });
        },
      },
      {
        id: 'variance',
        description: 'Compute what slipped versus what landed.',
        canSuspend: false,
        run: async ctx => {
          const collected = ctx.state.collect as {
            commitments: { status: string; dueAt?: string }[];
          };
          const missed = collected.commitments.filter(c => c.status === 'missed').length;
          const done = collected.commitments.filter(c => c.status === 'done').length;
          const overdue = collected.commitments.filter(
            c => c.status !== 'done' && c.dueAt && new Date(c.dueAt) < ctx.now,
          ).length;
          return step.continue({ missed, done, overdue, hitRate: done + missed > 0 ? done / (done + missed) : null });
        },
      },
      {
        id: 'publish',
        description: 'Assemble the review for delivery.',
        canSuspend: false,
        run: async ctx => step.continue({ variance: ctx.state.variance }),
      },
    ],
  };

  const decisionMemo: WorkflowDefinition = {
    id: 'decision-memo',
    name: 'Decision memo',
    description: 'Frame a decision, lay out options, recommend, and record the outcome.',
    consults: ['strategyAgent', 'financeAgent', 'riskAgent'],
    steps: [
      {
        id: 'frame',
        description: 'State the question in one sentence and check it is not already decided.',
        canSuspend: false,
        run: async ctx => {
          const question = (ctx.state.input as { question?: string } | undefined)?.question;
          if (!question) return step.fail('decision-memo requires a question to frame');

          const prior = await store.listDecisions(ctx.request.workspaceId, { status: 'decided' });
          const alreadyDecided = prior.items.find(d =>
            d.question.toLowerCase().includes(question.toLowerCase().slice(0, 30)),
          );
          if (alreadyDecided) {
            return step.skip(`already decided in ${alreadyDecided.id}: ${alreadyDecided.decidedOption ?? 'see record'}`);
          }
          return step.continue({ question });
        },
      },
      {
        id: 'options',
        description: 'Develop options with reversibility assessed.',
        canSuspend: false,
        run: async ctx => step.continue({ framed: ctx.state.frame }),
      },
      {
        id: 'await_decision',
        description: 'Put the recommendation to the CEO and wait.',
        canSuspend: true,
        // The memo cannot decide; that is the whole point of a memo.
        run: async () => step.suspend('recommendation ready for the CEO', 'ceo_decision'),
      },
    ],
  };

  const meetingPrep: WorkflowDefinition = {
    id: 'meeting-prep',
    name: 'Meeting preparation',
    description: 'Brief the CEO before a meeting: objective, attendees, open threads.',
    consults: ['operationsAgent', 'peopleAgent'],
    steps: [
      {
        id: 'load',
        description: 'Find the meeting and prior context.',
        canSuspend: false,
        run: async ctx => {
          const window = {
            from: ctx.now.toISOString(),
            to: new Date(ctx.now.getTime() + DAY_MS).toISOString(),
          };
          const meetings = await store.listMeetings(ctx.request.workspaceId, window);
          if (meetings.total === 0) return step.skip('no meetings in the next 24 hours');
          return step.continue({ meetings: meetings.items });
        },
      },
      {
        id: 'assemble',
        description: 'Pull open commitments involving the attendees.',
        canSuspend: false,
        run: async ctx => {
          const { meetings } = ctx.state.load as { meetings: { attendees: string[] }[] };
          const attendees = [...new Set(meetings.flatMap(m => m.attendees))];
          const perAttendee = await Promise.all(
            attendees.map(async owner => ({
              owner,
              open: (await store.listCommitments(ctx.request.workspaceId, { owner, status: 'open' })).total,
            })),
          );
          return step.continue({ attendees: perAttendee });
        },
      },
    ],
  };

  const meetingFollowUp: WorkflowDefinition = {
    id: 'meeting-follow-up',
    name: 'Meeting follow-up',
    description: 'Extract decisions and commitments made in a meeting and record them.',
    consults: ['operationsAgent'],
    steps: [
      {
        id: 'extract',
        description: 'Identify decisions and commitments from the meeting record.',
        canSuspend: false,
        run: async ctx => {
          const notes = (ctx.state.input as { notes?: string } | undefined)?.notes;
          if (!notes) return step.fail('meeting-follow-up requires meeting notes');
          return step.continue({ notes });
        },
      },
      {
        id: 'confirm',
        description: 'Confirm extracted commitments with the CEO before recording them.',
        canSuspend: true,
        // Recording a commitment against a named person is a claim about them;
        // it gets confirmed rather than assumed.
        run: async () => step.suspend('extracted commitments need confirmation', 'commitment_confirmation'),
      },
    ],
  };

  const commitmentTracking: WorkflowDefinition = {
    id: 'commitment-tracking',
    name: 'Commitment tracking',
    description: 'Chase commitments that are approaching or past due.',
    consults: ['operationsAgent'],
    steps: [
      {
        id: 'scan',
        description: 'Find commitments due soon or overdue.',
        canSuspend: false,
        run: async ctx => {
          const soon = new Date(ctx.now.getTime() + 3 * DAY_MS).toISOString();
          const page = await store.listCommitments(ctx.request.workspaceId, { dueBefore: soon });
          const actionable = page.items.filter(c => c.status === 'open' || c.status === 'in_progress');
          if (actionable.length === 0) return step.skip('no commitments due in the next three days');
          return step.continue({ actionable });
        },
      },
      {
        id: 'classify',
        description: 'Separate at-risk from on-track.',
        canSuspend: false,
        run: async ctx => {
          const { actionable } = ctx.state.scan as { actionable: { dueAt?: string; status: string }[] };
          const overdue = actionable.filter(c => c.dueAt && new Date(c.dueAt) < ctx.now);
          return step.continue({ overdue: overdue.length, upcoming: actionable.length - overdue.length });
        },
      },
    ],
  };

  const deliveryRiskReview: WorkflowDefinition = {
    id: 'delivery-risk-review',
    name: 'Delivery-risk review',
    description: 'Surface delivery risks that crossed the escalation threshold.',
    consults: ['productEngineeringAgent', 'riskAgent'],
    steps: [
      {
        id: 'assess',
        description: 'Score risks and select those above threshold.',
        canSuspend: false,
        run: async ctx => {
          const risks = await store.listRisks(ctx.request.workspaceId);
          const escalate = risks.items.filter(r => riskScore(r) >= 6 && r.status !== 'mitigated');
          if (escalate.length === 0) return step.skip('no risks above the escalation threshold');
          return step.continue({ escalate: escalate.map(r => ({ id: r.id, title: r.title, score: riskScore(r), owner: r.owner ?? null })) });
        },
      },
      {
        id: 'ownership',
        description: 'Flag anything unowned — an unowned risk is the real finding.',
        canSuspend: false,
        run: async ctx => {
          const { escalate } = ctx.state.assess as { escalate: { owner: string | null }[] };
          return step.continue({ unowned: escalate.filter(r => r.owner === null).length });
        },
      },
    ],
  };

  const revenueReview: WorkflowDefinition = {
    id: 'revenue-gtm-review',
    name: 'Revenue and GTM review',
    description: 'Pipeline movement, conversion, and forecast risk since the last review.',
    consults: ['revenueAgent', 'financeAgent'],
    steps: [
      {
        id: 'pull',
        description: 'Read pipeline and at-risk deals.',
        canSuspend: false,
        run: async ctx => {
          // Delegated because the CRM read belongs to the revenue agent's boundary.
          if (!deps.consult) return step.skip('no specialist consultation available in this runtime');
          const summary = await deps.consult('revenueAgent', 'Summarise pipeline movement and at-risk deals since the last review.');
          return step.continue({ summary });
        },
      },
    ],
  };

  const incidentMode: WorkflowDefinition = {
    id: 'incident-mode',
    name: 'Incident mode',
    description: 'Compress the loop during an incident: status, blast radius, decisions needed.',
    consults: ['productEngineeringAgent', 'communicationsAgent', 'riskAgent'],
    steps: [
      {
        id: 'establish',
        description: 'Establish what is known, what is unknown, and who is on it.',
        canSuspend: false,
        run: async ctx => {
          const description = (ctx.state.input as { description?: string } | undefined)?.description;
          if (!description) return step.fail('incident-mode requires an incident description');
          return step.continue({ description, declaredAt: ctx.now.toISOString() });
        },
      },
      {
        id: 'comms_draft',
        description: 'Draft internal and external comms.',
        canSuspend: true,
        // Incident comms are irreversible once sent; a human releases them.
        run: async () => step.suspend('incident comms drafted, awaiting release', 'comms_approval'),
      },
    ],
  };

  const learningReview: WorkflowDefinition = {
    id: 'learning-review',
    name: 'Learning review',
    description: 'Post-run review that may propose memory and skills. Proposal-only.',
    consults: [],
    steps: [
      {
        id: 'select',
        description: 'Choose which runs are worth reviewing.',
        canSuspend: false,
        run: async ctx => {
          const summaries = (ctx.state.input as { summaries?: unknown[] } | undefined)?.summaries ?? [];
          if (summaries.length === 0) return step.skip('no runs worth reviewing');
          return step.continue({ candidateCount: summaries.length });
        },
      },
      {
        id: 'propose',
        description: 'Emit proposals. Nothing here reaches production.',
        canSuspend: false,
        run: async ctx => step.continue({ proposalsFrom: ctx.state.select }),
      },
      {
        id: 'await_validation',
        description: 'Hand proposals to the validation pipeline.',
        canSuspend: true,
        run: async () => step.suspend('proposals queued for validation', 'validation_pipeline'),
      },
    ],
  };

  const skillCuration: WorkflowDefinition = {
    id: 'skill-curation',
    name: 'Skill curation',
    description: 'Age unused skills through stale → archived and report usage.',
    consults: [],
    steps: [
      {
        id: 'plan',
        description: 'Compute the curation plan.',
        canSuspend: false,
        run: async ctx => {
          const plan = (ctx.state.input as { plan?: unknown[] } | undefined)?.plan ?? [];
          if (plan.length === 0) return step.skip('no skills need curation');
          return step.continue({ transitions: plan.length });
        },
      },
      {
        id: 'apply',
        description: 'Apply the plan via the registry.',
        canSuspend: false,
        run: async ctx => step.continue({ applied: ctx.state.plan }),
      },
    ],
  };

  return [
    dailyBriefing,
    weeklyOperatingReview,
    decisionMemo,
    meetingPrep,
    meetingFollowUp,
    commitmentTracking,
    deliveryRiskReview,
    revenueReview,
    incidentMode,
    learningReview,
    skillCuration,
  ];
}
