import { z } from 'zod';

import { RoleSchema } from '@ceo/contracts';

/**
 * Access-policy configuration (plan §1).
 *
 * "Mastra's Slack adapter does not include a built-in user allowlist; valid Slack
 * users can otherwise invoke the agent wherever the bot is present." So this file
 * is the allowlist. It is data, loaded from config, versioned in git, and never
 * derived from Slack group membership at runtime.
 *
 * Deny-by-default is structural: the schema has no wildcard, and every lookup
 * helper returns `undefined` for anything not explicitly listed.
 */

export const UserPolicySchema = z
  .object({
    userId: z.string().min(1),
    role: RoleSchema,
    /** Optional note for the operator; never shown to the model. */
    label: z.string().optional(),
  })
  .strict();

export const ChannelPolicyEntrySchema = z
  .object({
    channelId: z.string().min(1),
    policy: z.enum(['trusted', 'restricted', 'external']),
    label: z.string().optional(),
  })
  .strict();

export const WorkspacePolicySchema = z
  .object({
    workspaceId: z.string().min(1),
    label: z.string().optional(),
    users: z.array(UserPolicySchema),
    channels: z.array(ChannelPolicyEntrySchema),
    /**
     * Plan §1: "Slack Connect denied by default." Flipping this to true is a
     * deliberate, reviewable act — and even then external channels stay read-only
     * because tool descriptors gate on surface independently.
     */
    allowSlackConnect: z.boolean().default(false),
  })
  .strict();
export type WorkspacePolicy = z.infer<typeof WorkspacePolicySchema>;

export const AccessPolicySchema = z
  .object({
    workspaces: z.array(WorkspacePolicySchema),
  })
  .strict();
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

export function findWorkspace(policy: AccessPolicy, workspaceId: string): WorkspacePolicy | undefined {
  return policy.workspaces.find(w => w.workspaceId === workspaceId);
}

export function findUserRole(workspace: WorkspacePolicy, userId: string) {
  return workspace.users.find(u => u.userId === userId)?.role;
}

export function findChannelPolicy(workspace: WorkspacePolicy, channelId: string) {
  return workspace.channels.find(c => c.channelId === channelId)?.policy;
}

/** An empty policy: every workspace, user and channel is unknown, so all are denied. */
export const EMPTY_POLICY: AccessPolicy = { workspaces: [] };
