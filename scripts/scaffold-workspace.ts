/**
 * Generates the package.json / tsconfig.json / project.json for every workspace
 * package. Re-runnable: it only writes files that do not already exist, so
 * hand-edits survive. Run with `node scripts/scaffold-workspace.mjs`.
 *
 * Mastra's monorepo guidance requires every workspace package consumed by Mastra
 * to carry its own package.json — that is why even leaf libs get one (plan §5).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PACKAGES } from './workspace-packages.ts';

const root = new URL('..', import.meta.url).pathname;

function writeIfAbsent(path: string, contents: string): boolean {
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return true;
}

let created = 0;
for (const pkg of PACKAGES) {
  const isApp = pkg.layer === 'app';

  const packageJson = {
    name: pkg.name,
    version: '0.1.0',
    description: pkg.desc,
    private: true,
    type: 'module',
    main: './src/index.ts',
    types: './src/index.ts',
    exports: { '.': './src/index.ts' },
  };

  const tsconfig = {
    extends: '../../tsconfig.base.json',
    compilerOptions: { rootDir: 'src' },
    include: ['src/**/*.ts'],
  };

  const projectJson = {
    name: pkg.name.replace('@ceo/', 'ceo-'),
    $schema: '../../node_modules/nx/schemas/project-schema.json',
    sourceRoot: `${pkg.dir}/src`,
    projectType: isApp ? 'application' : 'library',
    tags: [`layer:${pkg.layer}`],
    targets: {
      typecheck: {
        executor: 'nx:run-commands',
        options: { command: `tsc -p ${pkg.dir}/tsconfig.json --noEmit`, cwd: '.' },
      },
    },
  };

  if (writeIfAbsent(join(root, pkg.dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')) created++;
  if (writeIfAbsent(join(root, pkg.dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n')) created++;
  if (writeIfAbsent(join(root, pkg.dir, 'project.json'), JSON.stringify(projectJson, null, 2) + '\n')) created++;
}

// tsconfig.base.json path aliases must always reflect the package list.
const basePath = join(root, 'tsconfig.base.json');
if (existsSync(basePath)) {
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  base.compilerOptions.paths = Object.fromEntries(
    PACKAGES.map(p => [p.name, [`./${p.dir}/src/index.ts`]]),
  );
  writeFileSync(basePath, JSON.stringify(base, null, 2) + '\n');
}

console.log(`scaffold: ${created} files created across ${PACKAGES.length} packages`);
