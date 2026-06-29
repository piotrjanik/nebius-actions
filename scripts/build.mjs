#!/usr/bin/env node
/**
 * Build script: bundle every action entrypoint into its committed dist/.
 *
 * Discovery (the contract for later agents):
 *   - The action list is DERIVED from the files present in `src/entrypoints/`.
 *   - Each `src/entrypoints/<name>.ts` maps to `actions/<name>/dist/index.js`.
 *   - <name> is the entrypoint filename without its `.ts` extension and becomes
 *     the action directory name verbatim (e.g. `run-job.ts` -> `actions/run-job`).
 *   - Files starting with `.` or `_`, and `*.test.ts` / `*.spec.ts`, are ignored.
 *
 * Bundling:
 *   - Uses @vercel/ncc programmatically (single self-contained dist/index.js).
 *   - minify: off (readable, debuggable, and stable diffs for the dist-drift check).
 *   - license file emitted (dist/licenses.txt) when ncc collects third-party licenses.
 *
 * The committed dist/ is required (see spec §3, §8): .gitignore must NOT ignore it.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENTRYPOINTS_DIR = join(ROOT, 'src', 'entrypoints');
const ACTIONS_DIR = join(ROOT, 'actions');

/** Filename -> action name. `run-job.ts` -> `run-job`. */
function actionNameFromEntrypoint(file) {
  return file.replace(/\.ts$/, '');
}

function isEntrypoint(file) {
  if (!file.endsWith('.ts')) return false;
  if (file.startsWith('.') || file.startsWith('_')) return false;
  if (/\.(test|spec)\.ts$/.test(file)) return false;
  return true;
}

async function discoverEntrypoints() {
  if (!existsSync(ENTRYPOINTS_DIR)) {
    throw new Error(
      `No entrypoints directory found at ${ENTRYPOINTS_DIR}. ` +
        `Create src/entrypoints/<name>.ts files before building.`,
    );
  }
  const files = (await readdir(ENTRYPOINTS_DIR)).filter(isEntrypoint).sort();
  if (files.length === 0) {
    throw new Error(
      `No entrypoints found in ${ENTRYPOINTS_DIR}. ` +
        `Expected at least one src/entrypoints/<name>.ts file.`,
    );
  }
  return files.map((file) => ({
    name: actionNameFromEntrypoint(file),
    input: join(ENTRYPOINTS_DIR, file),
    outDir: join(ACTIONS_DIR, actionNameFromEntrypoint(file), 'dist'),
  }));
}

async function bundleOne(ncc, { name, input, outDir }) {
  process.stdout.write(`  building ${name} ... `);
  const { code, assets } = await ncc(input, {
    minify: false,
    sourceMap: false,
    cache: false,
    license: 'licenses.txt',
    quiet: true,
    target: 'es2022',
    // Action runtime is plain Node 20: bundle every dependency in (no externals),
    // so the committed dist/index.js runs without an installed node_modules.
  });

  // Replace the dist dir so stale assets never linger (keeps dist-drift honest).
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  // Normalize to LF so the committed bundle is byte-identical across platforms.
  // Some vendored dependency chunks ship CRLF; ncc concatenates them verbatim,
  // which would otherwise make a fresh build differ from the committed (LF) dist
  // on runners without core.autocrlf, breaking the dist-drift gate.
  await writeFile(join(outDir, 'index.js'), code.replace(/\r\n/g, '\n'), 'utf8');

  for (const [assetPath, asset] of Object.entries(assets ?? {})) {
    const dest = join(outDir, assetPath);
    await mkdir(dirname(dest), { recursive: true });
    const data = asset?.source ?? asset;
    await writeFile(dest, data);
  }

  process.stdout.write('done\n');
}

async function main() {
  // @vercel/ncc exposes a CommonJS function export; load via createRequire.
  const ncc = require('@vercel/ncc');

  const entrypoints = await discoverEntrypoints();
  console.log(
    `Discovered ${entrypoints.length} entrypoint(s): ${entrypoints.map((e) => e.name).join(', ')}`,
  );

  for (const ep of entrypoints) {
    await bundleOne(ncc, ep);
  }

  console.log(`\nBuilt ${entrypoints.length} action bundle(s) into actions/<name>/dist/index.js`);
}

main().catch((err) => {
  console.error('\nBuild failed:');
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
