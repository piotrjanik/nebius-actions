/**
 * `delete-endpoint` action entrypoint (low-level).
 *
 * Deletes an Endpoint identified by `endpoint-id` or `name`.
 */

import { deleteEndpoint, ensureCli, fail, getString, log, setOutput } from '../core';

async function run(): Promise<void> {
  const endpointId = getString('endpoint-id');
  const name = getString('name');
  const target = endpointId || name;
  if (!target) {
    throw new Error("Either 'endpoint-id' or 'name' must be provided.");
  }

  await ensureCli({ version: 'latest' });

  await log.group('Delete endpoint', async () => {
    await deleteEndpoint(target);
    log.info(`Deleted endpoint ${target}.`);
  });

  setOutput('status', 'DELETED');
}

run().catch((err) => fail(err));
