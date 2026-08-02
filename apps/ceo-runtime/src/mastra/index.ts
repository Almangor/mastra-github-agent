/**
 * Mastra entrypoint for `mastra dev` / `mastra build`.
 *
 * The playground talks to this. Note that the agents registered here are the same
 * objects the Slack control plane uses — there is no "demo" variant, so what you
 * see in Studio is what production runs.
 */
import 'dotenv/config';

import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';

import { toMastraWorkflows } from '@ceo/platform-mastra';

import { compose } from '../composition.ts';

const composition = compose();

export const mastra = new Mastra({
  agents: composition.agents,
  // The same definitions the worker and the eval harness run — adapted, not copied.
  workflows: toMastraWorkflows(composition.workflows) as never,
  storage: new LibSQLStore({ id: 'ceo-agent', url: composition.env.CEO_DB_URL }),
  logger: new PinoLogger({ name: 'ceo-agent', level: 'info' }),
});

export { composition };
