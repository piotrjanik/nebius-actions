/**
 * `setup` action entrypoint.
 *
 * Installs + caches the `nebius` CLI, performs the keyless GitHub OIDC ->
 * Nebius IAM token exchange, exports the token for downstream steps, and
 * configures the CLI. Run once per job before any resource action.
 */

import {
  authenticate,
  configureCliAuth,
  ensureCli,
  fail,
  getBool,
  getString,
  log,
  setOutput,
  DEFAULT_REGION,
  DEFAULT_TOKEN_EXCHANGE_URL,
} from '../core';

async function run(): Promise<void> {
  const authMethod = getString('auth-method', { default: 'oidc' });
  const audience = getString('audience');
  const tokenExchangeUrl = getString('token-exchange-url', {
    default: DEFAULT_TOKEN_EXCHANGE_URL,
  });
  // Empty -> the exchange falls back to SUBJECT_TOKEN_TYPE (id_token, the correct
  // type for a GitHub OIDC ID token). Override to `…:jwt` only for self-signed SA tokens.
  const subjectTokenType = getString('subject-token-type');
  const cliVersion = getString('cli-version', { default: 'latest' });
  const installCli = getBool('install-cli', { default: true });
  // region is accepted for forward-compatibility / profile selection.
  getString('region', { default: DEFAULT_REGION });

  if (authMethod !== 'oidc') {
    throw new Error(`Unsupported auth-method '${authMethod}'. Only 'oidc' is supported in v1.`);
  }

  if (installCli) {
    await log.group('Install nebius CLI', async () => {
      const dir = await ensureCli({ version: cliVersion });
      log.info(`nebius CLI ready at ${dir}`);
    });
  } else {
    log.info('install-cli=false: skipping CLI installation.');
  }

  const result = await log.group('Authenticate (OIDC token exchange)', async () => {
    const auth = await authenticate({
      method: 'oidc',
      endpoint: tokenExchangeUrl,
      ...(audience !== '' ? { audience } : {}),
      ...(subjectTokenType !== '' ? { subjectTokenType } : {}),
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
