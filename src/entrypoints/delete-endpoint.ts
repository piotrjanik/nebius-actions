/**
 * `delete-endpoint` action entrypoint (low-level).
 *
 * Deletes an Endpoint identified by `endpoint-id`, or by `name` within a
 * `project-id` (the SDK deletes by id only, so a name is resolved to an id via
 * get-by-name first). Uses the Nebius SDK; requires `auth` to have exported
 * NEBIUS_IAM_TOKEN (the `setup`/CLI action is not needed).
 */

import {
  createSdk,
  deleteEndpoint,
  endpointService,
  fail,
  getEndpointByName,
  getString,
  log,
  setOutput,
} from '../core';

async function run(): Promise<void> {
  const endpointId = getString('endpoint-id');
  const name = getString('name');
  const projectId = getString('project-id');
  if (!endpointId && !name) {
    throw new Error("Either 'endpoint-id' or 'name' must be provided.");
  }
  if (!endpointId && name && !projectId) {
    throw new Error("Deleting by 'name' requires 'project-id' to resolve the endpoint id.");
  }

  const sdk = createSdk();
  try {
    const service = endpointService(sdk);

    await log.group('Delete endpoint', async () => {
      // The SDK deletes by id only; resolve a name to its id first.
      const id = endpointId || (await getEndpointByName(service, projectId, name)).id;
      if (!id) {
        throw new Error(`Could not resolve an endpoint id for '${name || endpointId}'.`);
      }
      await deleteEndpoint(service, id);
      log.info(`Deleted endpoint ${id}.`);
    });

    setOutput('status', 'DELETED');
  } finally {
    await sdk.close();
  }
}

run().catch((err) => fail(err));
