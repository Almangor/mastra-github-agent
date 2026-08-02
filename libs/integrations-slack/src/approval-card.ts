import type { ApprovalRequest } from '@ceo/contracts';

/**
 * Block Kit approval cards (plan §1).
 *
 * The card must describe the *effect*, not the tool. "Create Linear issue in ENG:
 * 'Migrate billing worker'" is approvable; "run linear.createIssue" is not — a
 * reviewer cannot consent to something they cannot see.
 *
 * The action values carry the approvalId only. The argument hash stays server-side:
 * the guard re-derives it at release time, so a tampered interaction payload cannot
 * widen what was approved.
 */

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export function renderApprovalCard(request: ApprovalRequest): SlackBlock[] {
  const irreversible = !request.reversible;

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: irreversible ? '⚠️ Approval required (irreversible)' : 'Approval required' },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${escapeMrkdwn(request.summary)}*` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Risk tier*\n${request.tier.replace(/^tier\d_/, '')}` },
        { type: 'mrkdwn', text: `*Blast radius*\n${escapeMrkdwn(request.blastRadius)}` },
        { type: 'mrkdwn', text: `*Requested by*\n<@${request.requestedBy}>` },
        { type: 'mrkdwn', text: `*Expires*\n<!date^${Math.floor(new Date(request.expiresAt).getTime() / 1000)}^{time}|${request.expiresAt}>` },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Approvable by: ${request.eligibleApproverRoles.join(', ')} · the requester cannot approve their own action`,
        },
      ],
    },
    {
      type: 'actions',
      block_id: `approval:${request.approvalId}`,
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: { type: 'plain_text', text: 'Approve' },
          action_id: 'approval_approve',
          value: request.approvalId,
          ...(irreversible
            ? {
                confirm: {
                  title: { type: 'plain_text', text: 'This cannot be undone' },
                  text: { type: 'mrkdwn', text: escapeMrkdwn(request.summary) },
                  confirm: { type: 'plain_text', text: 'Approve' },
                  deny: { type: 'plain_text', text: 'Cancel' },
                },
              }
            : {}),
        },
        {
          type: 'button',
          style: 'danger',
          text: { type: 'plain_text', text: 'Deny' },
          action_id: 'approval_deny',
          value: request.approvalId,
        },
      ],
    },
  ];
}

/** Slack mrkdwn is not Markdown; only these three characters need escaping. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Immediate acknowledgement posted before any model work begins (plan §1). */
export function renderAcknowledgement(): SlackBlock[] {
  return [{ type: 'context', elements: [{ type: 'mrkdwn', text: '_Working on it…_' }] }];
}
