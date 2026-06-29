/**
 * `auth` action entrypoint.
 *
 * Authenticates to Nebius and exports the resulting IAM token as
 * `NEBIUS_IAM_TOKEN` (masked) for the CLI and all downstream steps. Run once per
 * job. Two methods, selected by `auth-method`:
 *   - `oidc` (default): keyless GitHub OIDC -> IAM token exchange.
 *   - `key`           : a service-account authorized key (private-key JWT).
 *
 * This action does NOT install the CLI — `configureCliAuth` only sets env vars.
 * Use the `setup` action to put the `nebius` CLI on PATH.
 */

import {
  authenticate,
  configureCliAuth,
  fail,
  getString,
  log,
  setOutput,
  type AuthOptions,
} from '../core';

/** Build the method-specific auth options from action inputs. */
function readAuthOptions(): AuthOptions {
  const authMethod = getString('auth-method', { default: 'oidc' });
  // The service account to authenticate as (subject of both flows).
  const serviceAccountId = getString('service-account-id', { required: true });
  // Optional SDK domain override; empty -> SDK default (api.nebius.cloud:443).
  const domain = getString('domain');

  if (authMethod === 'oidc') {
    const audience = getString('audience');
    return {
      method: 'oidc',
      serviceAccountId,
      ...(audience !== '' ? { audience } : {}),
      ...(domain !== '' ? { domain } : {}),
    };
  }

  if (authMethod === 'key') {
    return {
      method: 'key',
      serviceAccountId,
      publicKeyId: getString('public-key-id', { required: true }),
      privateKeyPem: getString('private-key', { required: true }),
      ...(domain !== '' ? { domain } : {}),
    };
  }

  throw new Error(`Unsupported auth-method '${authMethod}'. Use 'oidc' or 'key'.`);
}

async function run(): Promise<void> {
  const options = readAuthOptions();
  const label = options.method === 'key' ? 'service-account key' : 'OIDC token exchange';

  const result = await log.group(`Authenticate (${label})`, async () => {
    const auth = await authenticate(options);
    await configureCliAuth(auth.token);
    return auth;
  });

  // The IAM token is intentionally NOT exposed as a step output: outputs can
  // propagate to job-level outputs where the producing job's masking does not
  // reliably carry over. Downstream steps read it from the NEBIUS_IAM_TOKEN env
  // var (exported by configureCliAuth), which stays masked in logs.
  setOutput('expires-in', result.expiresInSeconds);
  log.info(`Authenticated; IAM token expires in ~${result.expiresInSeconds}s.`);
}

run().catch((err) => fail(err));
