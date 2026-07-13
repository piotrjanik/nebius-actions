/**
 * `setup` action entrypoint.
 *
 * Installs + caches the `nebius` CLI and puts it on PATH, and exports job-wide
 * defaults (NEBIUS_PROJECT_ID / NEBIUS_SERVICE_ACCOUNT_ID). OPTIONAL — the
 * resource actions all talk to Nebius via the SDK (they read the token the
 * `auth` action exports); the CLI is only used for job log streaming and for
 * the caller's own `nebius` shell steps.
 *
 * Optionally also configures a key-based CLI profile (`~/.nebius/config.yaml`)
 * when a service-account key is supplied, so those CLI uses can authenticate.
 */

import {
  configureCliProfile,
  ensureCli,
  exportEnv,
  fail,
  getBool,
  getString,
  log,
  DEFAULT_REGION,
  PROJECT_ID_ENV,
  SERVICE_ACCOUNT_ID_ENV,
} from '../core';

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

  // Export project-id / service-account-id as job-wide defaults so later
  // resource steps inherit them and need not repeat these inputs. Independent of
  // the profile branch below — exportEnv no-ops on empty values.
  const projectId = getString('project-id');
  const serviceAccountId = getString('service-account-id');
  exportEnv(PROJECT_ID_ENV, projectId);
  exportEnv(SERVICE_ACCOUNT_ID_ENV, serviceAccountId);

  // Configure a key-based CLI profile only when a private key is supplied; with
  // no key the action stays install-only (backward compatible).
  const privateKey = getString('private-key');
  if (privateKey !== '') {
    await log.group('Configure nebius CLI profile (service-account key)', async () => {
      const name = getString('profile');
      const endpoint = getString('endpoint');
      const tenantId = getString('tenant-id');
      await configureCliProfile({
        serviceAccountId: getString('service-account-id', { required: true }),
        publicKeyId: getString('public-key-id', { required: true }),
        privateKeyPem: privateKey,
        ...(name !== '' ? { name } : {}),
        ...(endpoint !== '' ? { endpoint } : {}),
        ...(projectId !== '' ? { parentId: projectId } : {}),
        ...(tenantId !== '' ? { tenantId } : {}),
      });
      log.info('nebius CLI profile configured.');
    });
  }
}

run().catch((err) => fail(err));
