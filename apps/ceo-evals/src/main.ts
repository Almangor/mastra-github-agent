/**
 * Eval runner and release gate (plan §4).
 *
 * Exit code 0 means the build may ship. Non-zero means either a hard gate broke or
 * a quality threshold was missed — the caller does not need to distinguish, but the
 * report does.
 *
 *   npm run evals
 *   npm run evals -- --json     # machine-readable, for CI annotations
 */
import {
  DATASET_VERSION,
  QUALITY_THRESHOLDS,
  allCases,
  datasetStats,
  runExecutableSuites,
  summarise,
} from '@ceo/eval-kit';

const asJson = process.argv.includes('--json');

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const results = await runExecutableSuites();
  const summary = summarise(results, DATASET_VERSION, startedAt);
  const stats = datasetStats();

  if (asJson) {
    console.log(JSON.stringify({ summary, stats }, null, 2));
    return summary.passed ? 0 : 1;
  }

  console.log(`\nCEO agent release gates — dataset ${DATASET_VERSION}\n`);

  // Per-suite results against their thresholds.
  for (const threshold of QUALITY_THRESHOLDS) {
    const bucket = summary.bySuite[threshold.suite];
    if (!bucket) {
      console.log(
        `  ${yellow('–')} ${threshold.suite.padEnd(15)} ${dim('no executable cases (model-dependent)')}`,
      );
      continue;
    }
    const ok = bucket.passRate >= threshold.minPassRate;
    const pct = (bucket.passRate * 100).toFixed(1).padStart(5);
    console.log(
      `  ${ok ? green('✓') : red('✗')} ${threshold.suite.padEnd(15)} ${String(bucket.passed).padStart(3)}/${String(bucket.total).padEnd(3)} ${pct}%  ${dim(`(needs ${(threshold.minPassRate * 100).toFixed(0)}%)`)}`,
    );
  }

  // Hard gates.
  const gateCases = results.filter(r => r.isGate);
  const gatesPassed = gateCases.filter(r => r.passed).length;
  console.log(
    `\n  ${summary.gateFailures.length === 0 ? green('✓') : red('✗')} hard gates      ${gatesPassed}/${gateCases.length} safety cases passed`,
  );

  if (summary.gateFailures.length > 0) {
    console.log(`\n${red('Gate failures — these block the release:')}`);
    for (const failure of summary.gateFailures) {
      console.log(`  ${red('✗')} [${failure.suite}] ${failure.caseId}: ${failure.detail}`);
    }
  }
  if (summary.thresholdFailures.length > 0) {
    console.log(`\n${red('Quality thresholds missed:')}`);
    for (const failure of summary.thresholdFailures) {
      console.log(
        `  ${red('✗')} ${failure.suite}: ${(failure.passRate * 100).toFixed(1)}% < ${(failure.required * 100).toFixed(0)}%`,
      );
    }
  }

  // Non-executable coverage is reported, never counted as passing.
  const skipped = allCases().filter(c => !c.executable);
  if (skipped.length > 0) {
    console.log(
      `\n  ${yellow('!')} ${skipped.length} model-dependent case(s) not run (need ANTHROPIC_API_KEY): ` +
        `${[...new Set(skipped.map(c => c.suite))].join(', ')}`,
    );
    console.log(dim('    These are declared in the dataset and reported as skipped — never as passes.'));
  }

  const totalMs = results.reduce((acc, r) => acc + r.durationMs, 0);
  console.log(
    `\n  dataset: ${stats.total} cases (${stats.executable} executable, ${stats.modelDependent} model-dependent, ${stats.gates} gates)`,
  );
  console.log(`  ran ${results.length} executable cases in ${totalMs}ms\n`);
  console.log(summary.passed ? green('RELEASE GATES PASSED') : red('RELEASE BLOCKED'));

  return summary.passed ? 0 : 1;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
