/**
 * Scripted demo: runs the GitHub agent against a few questions and streams the
 * answers to stdout. This is the "does it actually work" proof for the README.
 *
 *   npm run demo
 *   npm run demo -- "What are the newest open issues on vercel/ai?"
 */
import 'dotenv/config';

import { mastra } from './mastra';

const DEFAULT_QUESTIONS = [
  'Give me an overview of the mastra-ai/mastra repository.',
  'What landed in the last few commits on mastra-ai/mastra? Summarise the themes.',
];

async function ask(question: string) {
  console.log(`\n\x1b[1m❯ ${question}\x1b[0m\n`);

  const agent = mastra.getAgent('githubAgent');
  const stream = await agent.stream(question);

  for await (const chunk of stream.textStream) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }

  const questions = process.argv.slice(2);
  for (const question of questions.length > 0 ? questions : DEFAULT_QUESTIONS) {
    await ask(question);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
