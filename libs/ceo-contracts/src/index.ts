/**
 * @ceo/contracts — the only package every other package may depend on.
 *
 * Everything here is a schema or a pure function over one. No I/O, no Mastra, no
 * network: that is what lets @ceo/policy stay testable without a live workspace,
 * and what keeps the dependency graph acyclic (see scripts/check-boundaries.ts).
 */
export * from './request-context.ts';
export * from './tool-risk.ts';
export * from './approval.ts';
export * from './skill-lifecycle.ts';
export * from './audit.ts';
