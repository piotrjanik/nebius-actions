/**
 * `deploy-endpoint` action entrypoint (convenience).
 *
 * Create an Endpoint via the Nebius SDK, then (when `wait`) poll until it is
 * serving. Fails on a terminal-failure status or timeout.
 *
 * The SDK has no endpoint *update* verb, so this creates the endpoint; if one
 * with the same name already exists it is returned as-is (never replaced — the
 * new spec is NOT applied). Requires `auth` to have exported NEBIUS_IAM_TOKEN;
 * the `setup`/CLI action is not needed for this path.
 */

import {
  PROJECT_ID_ENV,
  createSdk,
  deployEndpoint,
  endpointService,
  fail,
  getBool,
  getEndpoint,
  getKeyValues,
  getMultiline,
  getNumber,
  getString,
  getStringOrEnv,
  isEndpointReady,
  isEndpointTerminalFailure,
  log,
  mask,
  parseSizeBytes,
  pollUntil,
  resolveSubnetId,
  setOutput,
  subnetService,
  type Endpoint,
  type EndpointSpec,
} from '../core';

function buildSpecFromInputs(): EndpointSpec {
  const name = getString('name', { required: true });
  const image = getString('image', { required: true });
  const preset = getString('preset');
  const platform = getString('platform');
  const env = getKeyValues('env');
  const diskSize = getString('disk-size');
  const diskType = getString('disk-type');
  const subnetId = getString('subnet-id');
  const protocol = getString('protocol');
  const mounts = getMultiline('mounts');
  const command = getString('command');
  const args = getString('args');
  // Optional: falls back to NEBIUS_PROJECT_ID (exported by setup); needed both as
  // the endpoint parent and to auto-resolve a subnet.
  const projectId = getStringOrEnv('project-id', PROJECT_ID_ENV);
  const token = getString('token');
  // Register the bearer token as a secret so the runner redacts it everywhere
  // (it is sent to the API as the endpoint's authToken).
  if (token) mask(token);

  const spec: EndpointSpec = { name, image };
  if (getString('port') !== '') spec.port = getNumber('port');
  if (preset) spec.preset = preset;
  if (platform) spec.platform = platform;
  if (getBool('public', { default: false })) spec.public = true;
  if (token) spec.token = token;
  if (Object.keys(env).length > 0) spec.env = env;
  if (diskSize) spec.diskSizeBytes = parseSizeBytes(diskSize);
  if (diskType) spec.diskType = diskType;
  if (subnetId) spec.subnetId = subnetId;
  if (protocol) spec.protocol = protocol;
  if (mounts.length > 0) spec.mounts = mounts;
  if (command) spec.command = command;
  if (args) spec.args = args;
  if (projectId) spec.projectId = projectId;
  return spec;
}

async function run(): Promise<void> {
  const wait = getBool('wait', { default: true });
  const pollIntervalSec = getNumber('poll-interval', { default: 10 });
  const timeoutSec = getNumber('timeout', { default: 60 * 60 });
  const spec = buildSpecFromInputs();

  const sdk = createSdk();
  try {
    const service = endpointService(sdk);

    if (!spec.subnetId) {
      spec.subnetId = await resolveSubnetId(subnetService(sdk), spec.projectId ?? '');
      log.info(`Using subnet ${spec.subnetId}.`);
    }

    const deployed = await log.group('Deploy endpoint (create)', async () => {
      const ep = await deployEndpoint(service, spec);
      log.info(`Applied endpoint ${ep.id || ep.name} (status: ${ep.status}).`);
      return ep;
    });

    setOutput('endpoint-id', deployed.id);
    setOutput('status', deployed.status);
    if (deployed.url !== undefined) {
      setOutput('url', deployed.url);
    }

    if (!wait) {
      log.info('wait=false: returning immediately after create.');
      return;
    }

    const lookupId = deployed.id;
    if (!lookupId) {
      throw new Error('Endpoint was created but no id was returned; cannot wait for it.');
    }

    const { value: finalEp, timedOut } = await pollUntil<Endpoint>({
      fn: () => getEndpoint(service, lookupId),
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
      throw new Error(
        `Timed out waiting for endpoint ${lookupId}; last status: ${finalEp.status}.`,
      );
    }
    if (isEndpointTerminalFailure(finalEp.status)) {
      throw new Error(`Endpoint ${lookupId} failed to deploy (status '${finalEp.status}').`);
    }
    log.info(`Endpoint ${lookupId} is serving${finalEp.url ? ` at ${finalEp.url}` : ''}.`);
  } finally {
    await sdk.close();
  }
}

run().catch((err) => fail(err));
