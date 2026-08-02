/**
 * Module-boundary gate (plan §5: "project tags, dependency constraints").
 *
 * Enforces a strict layering so the dependency graph stays acyclic and the
 * security-critical layers stay leaf-ward of everything that talks to the world:
 *
 *   contracts   →  (nothing)
 *   domain      →  contracts
 *   platform    →  contracts, domain, platform
 *   integration →  contracts, domain, platform, integration
 *   core        →  contracts, domain, platform, integration, core
 *   app         →  anything
 *
 * Same-layer edges are legal above `domain`, so acyclicity is checked separately
 * rather than falling out of the layer table.
 *
 * The rule that actually matters: `domain` (which contains ceo-policy, the
 * authorization layer) cannot import an integration or the platform. Policy
 * decisions must be pure and testable without a network.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { PACKAGES, type Layer } from './workspace-packages.ts';

const ALLOWED: Record<Layer, Layer[]> = {
  contracts: [],
  // The constraint that carries the security weight: domain (which holds
  // ceo-policy) may not reach a platform or an integration. Authorization stays
  // pure, so the security evals run without a network and cannot be fooled by a
  // stubbed adapter.
  domain: ['contracts'],
  // Platform is infrastructure that *enforces* domain rules — platform-mastra's
  // guarded tool factory has to call into ceo-policy to do its job. Intra-layer
  // edges are allowed here and checked for cycles separately.
  platform: ['contracts', 'domain', 'platform'],
  integration: ['contracts', 'domain', 'platform', 'integration'],
  core: ['contracts', 'domain', 'platform', 'integration', 'core'],
  app: ['contracts', 'domain', 'platform', 'integration', 'core', 'app'],
};

const root = new URL('..', import.meta.url).pathname;
const byName = new Map(PACKAGES.map(p => [p.name, p]));
const byDir = [...PACKAGES].sort((a, b) => b.dir.length - a.dir.length);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const violations: string[] = [];
const graph = new Map<string, Set<string>>();
let edges = 0;

for (const dirName of ['apps', 'libs']) {
  for (const file of sourceFiles(join(root, dirName))) {
    const rel = relative(root, file);
    const owner = byDir.find(p => rel.startsWith(`${p.dir}/`));
    if (!owner) continue;

    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;

      // A relative import that climbs out of the owning package is a deep import
      // wearing a disguise — it bypasses the package surface and dodges the layer
      // rules entirely, so catch it before the @ceo/ check.
      if (spec.startsWith('.')) {
        const resolved = relative(root, join(dirname(file), spec));
        if (!resolved.startsWith(`${owner.dir}/`)) {
          const escapedTo = byDir.find(p => resolved.startsWith(`${p.dir}/`));
          violations.push(
            `${rel}: relative import "${spec}" escapes ${owner.name}` +
              (escapedTo ? ` into ${escapedTo.name} — import "${escapedTo.name}" instead` : ''),
          );
        }
        continue;
      }

      if (!spec.startsWith('@ceo/')) continue;

      // Deep imports bypass the package's public surface — always a violation.
      const target = byName.get(spec) ?? byName.get(spec.split('/').slice(0, 2).join('/'));
      if (!target) {
        violations.push(`${rel}: imports unknown workspace package "${spec}"`);
        continue;
      }
      if (spec !== target.name) {
        violations.push(`${rel}: deep import "${spec}" — import "${target.name}" instead`);
        continue;
      }
      if (target.name === owner.name) continue;

      edges++;
      graph.set(owner.name, (graph.get(owner.name) ?? new Set()).add(target.name));

      const allowed = ALLOWED[owner.layer] ?? [];
      if (!allowed.includes(target.layer)) {
        violations.push(
          `${rel}: layer:${owner.layer} may not depend on layer:${target.layer} (${owner.name} → ${target.name})`,
        );
      }
    }
  }
}

// Same-layer edges are permitted inside platform/integration/core, so the layer
// table alone no longer guarantees a DAG. Check acyclicity explicitly.
const CYCLE_MARK = { unvisited: 0, onStack: 1, done: 2 } as const;
const state = new Map<string, number>();
const stack: string[] = [];

function visit(node: string): void {
  const current = state.get(node) ?? CYCLE_MARK.unvisited;
  if (current === CYCLE_MARK.done) return;
  if (current === CYCLE_MARK.onStack) {
    const cycle = [...stack.slice(stack.indexOf(node)), node].join(' → ');
    violations.push(`dependency cycle: ${cycle}`);
    return;
  }
  state.set(node, CYCLE_MARK.onStack);
  stack.push(node);
  for (const next of graph.get(node) ?? []) visit(next);
  stack.pop();
  state.set(node, CYCLE_MARK.done);
}

for (const node of graph.keys()) visit(node);

if (violations.length > 0) {
  for (const v of violations) console.error(`  \x1b[31m✗\x1b[0m ${v}`);
  console.error(`\nboundaries: ${violations.length} violation(s) across ${edges} internal edges`);
  process.exit(1);
}

console.log(`  \x1b[32m✓\x1b[0m ${edges} internal dependency edges, all within the layer constraints`);
console.log(`  \x1b[32m✓\x1b[0m no deep imports — every cross-package import goes through a package root`);
console.log(`  \x1b[32m✓\x1b[0m dependency graph is acyclic`);
console.log(`\nboundaries: clean across ${PACKAGES.length} packages`);
