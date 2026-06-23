/**
 * `wait-for-endpoint` action entrypoint (low-level).
 *
 * Polls an existing Endpoint until it is serving. Fails on a terminal-failure
 * status or timeout.
 */

import {
  ensureCli,
  fail,
  getNumber,
  getString,
  getEndpoint,
  isEndpointReady,
  isEndpointTerminalFailure,
  log,
  pollUntil,
  setOutput,
  type Endpoint,
} from '../core';

async function run(): Promise<void> {
  const endpointId = getString('endpoint-id', { required: true });
  const pollIntervalSec = getNumber('poll-interval', { default: 10 });
  const timeoutSec = getNumber('timeout', { default: 60 * 60 });

  await ensureCli({ version: 'latest' });

  const { value: finalEp, timedOut } = await pollUntil<Endpoint>({
    fn: () => getEndpoint(endpointId),
    isTerminal: (e) => isEndpointReady(e.status) || isEndpointTerminalFailure(e.status),
    timeoutMs: Math.max(0, timeoutSec) * 1000,
    intervalMs: Math.max(0, pollIntervalSec) * 1000,
    onTick: (e) => log.info(`endpoint ${e.id || e.name}: ${e.status}`),
  });

  setOutput('status', finalEp.status);
  if (finalEp.url !== undefined) {
    setOutput('url', finalEp.url);
  }

  if (timedOut) {
    throw new Error(
      `Timed out waiting for endpoint ${endpointId}; last status: ${finalEp.status}.`,
    );
  }
  if (isEndpointTerminalFailure(finalEp.status)) {
    throw new Error(`Endpoint ${endpointId} is in a failure state ('${finalEp.status}').`);
  }
  log.info(`Endpoint ${endpointId} is serving${finalEp.url ? ` at ${finalEp.url}` : ''}.`);
}

run().catch((err) => fail(err));
