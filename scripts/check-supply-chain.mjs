/**
 * Supply-chain gate (plan §6).
 *
 * Fails the build when any of the mandatory controls regress. Run in CI before
 * anything else; `npm run verify` chains it first.
 *
 *   node scripts/check-supply-chain.mjs            # offline checks only
 *   node scripts/check-supply-chain.mjs --signatures  # + npm registry provenance
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const readJson = f => JSON.parse(read(f));

const failures = [];
const warnings = [];
const passed = [];

const fail = msg => failures.push(msg);
const warn = msg => warnings.push(msg);
const pass = msg => passed.push(msg);

const pkg = readJson('../package.json');
const lock = readJson('../package-lock.json');
const policy = readJson('./blocked-packages.json');

// --- 1. Exact version pinning -------------------------------------------------
// A caret range on a compromised namespace is what turns a single malicious
// publish into a fleet-wide incident. Everything must be pinned.
const EXACT_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const declared = { ...pkg.dependencies, ...pkg.devDependencies };
const unpinned = Object.entries(declared).filter(([, range]) => !EXACT_RE.test(range));
if (unpinned.length > 0) {
  fail(`Unpinned dependencies (plan §6 requires exact versions): ${unpinned.map(([n, r]) => `${n}@${r}`).join(', ')}`);
} else {
  pass(`All ${Object.keys(declared).length} root dependencies are pinned to exact versions`);
}

// --- 2. Blocked versions ------------------------------------------------------
// Walk the whole resolved tree, not just direct deps — a transitive pull of a
// known-bad version is the case that actually bites.
const blockedHits = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith('node_modules/')) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  for (const rule of policy.blocked) {
    if (rule.name === name && rule.versions.includes(entry.version)) {
      blockedHits.push(`${name}@${entry.version} at ${path} — ${rule.reason}`);
    }
  }
}
if (blockedHits.length > 0) {
  fail(`Blocked package versions present in the dependency tree:\n    - ${blockedHits.join('\n    - ')}`);
} else {
  const n = policy.blocked.reduce((acc, r) => acc + r.versions.length, 0);
  pass(`None of the ${n} blocked package versions are present in the tree`);
}

// --- 3. Frozen lockfile -------------------------------------------------------
if (!existsSync(`${root}package-lock.json`)) {
  fail('No package-lock.json committed — builds are not reproducible.');
} else if ((lock.lockfileVersion ?? 0) < 3) {
  fail(`lockfileVersion ${lock.lockfileVersion} is too old; v3+ is required for integrity + resolved URLs on every entry.`);
} else {
  pass(`Frozen lockfile present (lockfileVersion ${lock.lockfileVersion}); CI must install with \`npm ci\``);
}

// --- 4. Install scripts denied by default ------------------------------------
const npmrc = existsSync(`${root}.npmrc`) ? readFileSync(`${root}.npmrc`, 'utf8') : '';
if (!/^ignore-scripts\s*=\s*true$/m.test(npmrc)) {
  fail('.npmrc must set `ignore-scripts=true` — install scripts are the primary execution vector for a compromised package.');
} else {
  pass('Dependency install scripts are denied by default (.npmrc ignore-scripts=true)');
}

// Report which packages *would* have executed, so the denial is auditable.
const withInstallScripts = Object.entries(lock.packages ?? {})
  .filter(([path, e]) => path.startsWith('node_modules/') && e.hasInstallScript)
  .map(([path]) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length));
if (withInstallScripts.length > 0) {
  warn(`${withInstallScripts.length} package(s) declare install scripts that are being suppressed: ${[...new Set(withInstallScripts)].sort().join(', ')}`);
}

// --- 5. Integrity + resolved URL on every entry -------------------------------
const missingIntegrity = Object.entries(lock.packages ?? {})
  .filter(([path, e]) => path.startsWith('node_modules/') && !e.link && !e.integrity)
  .map(([path]) => path);
if (missingIntegrity.length > 0) {
  fail(`${missingIntegrity.length} lockfile entries lack an integrity hash: ${missingIntegrity.slice(0, 5).join(', ')}${missingIntegrity.length > 5 ? ' …' : ''}`);
} else {
  pass('Every third-party lockfile entry carries an integrity hash');
}

// --- 6. The agent must never be able to install packages ----------------------
// A learned skill or an injected prompt that can reach `npm install` defeats
// every control above. Grep the shipped source for install invocations.
let installEscapes = '';
try {
  installEscapes = execFileSync(
    'git',
    ['grep', '-nE', '(npm|pnpm|yarn|bun)\\s+(i|install|add)|execFile\\(.?.(npm|pnpm|yarn)', '--', 'apps', 'libs'],
    { cwd: root, encoding: 'utf8' },
  );
} catch {
  // git grep exits non-zero when there are no matches — that is the good path.
}
if (installEscapes.trim()) {
  fail(`Runtime source appears able to install packages, which plan §6 forbids:\n${installEscapes}`);
} else {
  pass('No package-install capability reachable from apps/ or libs/ source');
}

// --- 7. Registry provenance (opt-in; needs network) --------------------------
if (process.argv.includes('--signatures')) {
  try {
    execFileSync('npm', ['audit', 'signatures'], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
    pass('npm registry signatures and provenance attestations verified');
  } catch (error) {
    fail(`npm audit signatures failed — provenance could not be verified:\n${error.stdout ?? error.message}`);
  }
} else {
  warn('Registry provenance not checked (re-run with --signatures; CI does this on every build)');
}

// --- report -------------------------------------------------------------------
for (const p of passed) console.log(`  \x1b[32m✓\x1b[0m ${p}`);
for (const w of warnings) console.log(`  \x1b[33m!\x1b[0m ${w}`);
for (const f of failures) console.error(`  \x1b[31m✗\x1b[0m ${f}`);

console.log(
  `\nsupply-chain: ${passed.length} passed, ${warnings.length} warning(s), ${failures.length} failure(s)`,
);
process.exit(failures.length > 0 ? 1 : 0);
