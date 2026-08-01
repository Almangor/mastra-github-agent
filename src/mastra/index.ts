import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';

import { githubAgent } from './agents/github-agent';

export const mastra = new Mastra({
  agents: { githubAgent },
  storage: new LibSQLStore({ id: 'mastra-github-agent', url: 'file:./mastra.db' }),
  logger: new PinoLogger({ name: 'mastra-github-agent', level: 'info' }),
});
