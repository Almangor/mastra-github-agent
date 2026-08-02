/**
 * @ceo/agents — the CEO supervisor and the nine specialists.
 *
 * Tool boundaries are enforced at construction (see build.ts), so a mis-scoped
 * agent fails the build rather than failing in production.
 */
export * from './roster.ts';
export * from './executive-tools.ts';
export * from './build.ts';
