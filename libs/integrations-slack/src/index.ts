/**
 * @ceo/integrations-slack — the control plane.
 *
 * Order of operations for every inbound event, and none of it is optional:
 *   verifySlackRequest  → dedup (@ceo/policy)  → buildRequestContext
 *   → admitRequest (@ceo/policy)               → agent turn
 */
export * from './verify.ts';
export * from './context.ts';
export * from './approval-card.ts';
