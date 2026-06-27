/**
 * `setup` action entrypoint.
 *
 * Installs + caches the `nebius` CLI and puts it on PATH. Run once per job
 * before any resource action. Authentication is handled separately by the
 * `auth` action (keyless OIDC token exchange).
 */

import { ensureCli, fail, getBool, getString, log, DEFAULT_REGION } from '../core';

async function run(): Promise<void> {
  const cliVersion = getString('cli-version', { default: 'latest' });
  const installCli = getBool('install-cli', { default: true });
  // region is accepted for forward-compatibility / profile selection.
  getString('region', { default: DEFAULT_REGION });

  if (installCli) {
    await log.group('Install nebius CLI', async () => {
      const dir = await ensureCli({ version: cliVersion });
      log.info(`nebius CLI ready at ${dir}`);
    });
  } else {
    log.info('install-cli=false: skipping CLI installation.');
  }
}

run().catch((err) => fail(err));
