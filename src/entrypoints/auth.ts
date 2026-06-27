/**
 * `auth` action entrypoint.
 *
 * Performs the keyless GitHub OIDC -> Nebius IAM token exchange (federated
 * credentials, over gRPC via `@nebius/js-sdk`), masks the token, and exports it
 * as `NEBIUS_IAM_TOKEN` for the CLI and all downstream steps. Run once per job.
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
} from '../core';

async function run(): Promise<void> {
  const authMethod = getString('auth-method', { default: 'oidc' });
  // The service account this workflow impersonates via federated credentials.
  const serviceAccountId = getString('service-account-id', { required: true });
  const audience = getString('audience');
  // Optional SDK domain override; empty -> SDK default (api.nebius.cloud:443).
  const domain = getString('domain');

  if (authMethod !== 'oidc') {
    throw new Error(`Unsupported auth-method '${authMethod}'. Only 'oidc' is supported in v1.`);
  }

  const result = await log.group('Authenticate (OIDC token exchange)', async () => {
    const auth = await authenticate({
      method: 'oidc',
      serviceAccountId,
      ...(audience !== '' ? { audience } : {}),
      ...(domain !== '' ? { domain } : {}),
    });
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
