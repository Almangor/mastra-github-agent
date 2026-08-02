/**
 * @ceo/runtime — the composition root plus the Slack turn pipeline.
 *
 * Exported so the worker and the admin CLI can share one composition instead of
 * each assembling its own (and drifting).
 */
export * from './composition.ts';
export * from './slack-turn.ts';
