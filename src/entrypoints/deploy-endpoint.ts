/**
 * `deploy-endpoint` action entrypoint (convenience).
 *
 * Create-or-update (apply) an Endpoint, then (when `wait`) poll until it is
 * serving. Fails on a terminal-failure status or timeout.
 */

import {
  deployEndpoint,
  ensureCli,
  fail,
  getBool,
  getKeyValues,
  getMultiline,
  getNumber,
  getString,
  getEndpoint,
  isEndpointReady,
  isEndpointTerminalFailure,
  log,
  mask,
  pollUntil,
  setOutput,
  type Endpoint,
  type EndpointSpec,
} from '../core';

function buildSpecFromInputs(): EndpointSpec {
  const name = getString('name', { required: true });
  const image = getString('image', { required: true });
  const preset = getString('preset');
  const platform = getString('platform');
  const env = getKeyValues('env');
  const projectId = getString('project-id');
  const auth = getString('auth');
  const token = getString('token');
  // Register the bearer token as a secret so the runner redacts it everywhere —
  // the CLI args (--token <token>) and the echoed `token` output included.
  if (token) mask(token);
  const extraArgs = getMultiline('extra-args');

  const spec: EndpointSpec = { name, image };
  if (getString('port') !== '') spec.port = getNumber('port');
  if (preset) spec.preset = preset;
  if (platform) spec.platform = platform;
  if (getBool('public', { default: false })) spec.public = true;
  if (auth) spec.auth = auth;
  if (token) spec.token = token;
  if (getString('min-replicas') !== '') spec.minReplicas = getNumber('min-replicas');
  if (getString('max-replicas') !== '') spec.maxReplicas = getNumber('max-replicas');
  if (Object.keys(env).length > 0) spec.env = env;
  if (projectId) spec.projectId = projectId;
  if (extraArgs.length > 0) spec.extraArgs = extraArgs;
  return spec;
}

async function run(): Promise<void> {
  const wait = getBool('wait', { default: true });
  const pollIntervalSec = getNumber('poll-interval', { default: 10 });
  const timeoutSec = getNumber('timeout', { default: 60 * 60 });

  await ensureCli({ version: 'latest' });
  const spec = buildSpecFromInputs();

  const deployed = await log.group('Deploy endpoint (apply)', async () => {
    const ep = await deployEndpoint(spec);
    log.info(`Applied endpoint ${ep.id || ep.name} (status: ${ep.status}).`);
    return ep;
  });

  setOutput('endpoint-id', deployed.id);
  setOutput('status', deployed.status);
  if (deployed.url !== undefined) {
    setOutput('url', deployed.url);
  }
  // Echo the bearer token back so callers can authenticate to the served URL.
  if (spec.token) {
    setOutput('token', spec.token);
  }

  if (!wait) {
    log.info('wait=false: returning immediately after apply.');
    return;
  }

  const lookupKey = deployed.id || deployed.name || spec.name;
  const { value: finalEp, timedOut } = await pollUntil<Endpoint>({
    fn: () => getEndpoint(lookupKey),
    isTerminal: (e) => isEndpointReady(e.status) || isEndpointTerminalFailure(e.status),
    timeoutMs: Math.max(0, timeoutSec) * 1000,
    intervalMs: Math.max(0, pollIntervalSec) * 1000,
    onTick: (e) => log.info(`endpoint ${e.id || e.name}: ${e.status}`),
  });

  setOutput('status', finalEp.status);
  if (finalEp.id) {
    setOutput('endpoint-id', finalEp.id);
  }
  if (finalEp.url !== undefined) {
    setOutput('url', finalEp.url);
  }

  if (timedOut) {
    throw new Error(`Timed out waiting for endpoint ${lookupKey}; last status: ${finalEp.status}.`);
  }
  if (isEndpointTerminalFailure(finalEp.status)) {
    throw new Error(`Endpoint ${lookupKey} failed to deploy (status '${finalEp.status}').`);
  }
  log.info(`Endpoint ${lookupKey} is serving${finalEp.url ? ` at ${finalEp.url}` : ''}.`);
}

run().catch((err) => fail(err));
