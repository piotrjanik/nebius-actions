/**
 * `create-bucket` action entrypoint (control plane; no aws-sdk).
 *
 * Imports bucket helpers from the storage subpath (not the ../core/storage
 * barrel) so this action's bundle stays free of @aws-sdk/client-s3.
 */

import { ensureCli, fail, log, setOutput, getString, getStringOrEnv, PROJECT_ID_ENV } from '../core';
import { createBucket } from '../core/storage/bucket';

async function run(): Promise<void> {
  await ensureCli({ version: 'latest' });
  const name = getString('name', { required: true });
  const projectId = getStringOrEnv('project-id', PROJECT_ID_ENV, { required: true });
  const maxSizeBytes = getString('max-size-bytes');

  const ref = await log.group('Create bucket', async () => {
    const r = await createBucket({ name, projectId, ...(maxSizeBytes ? { maxSizeBytes } : {}) });
    log.info(`Created bucket ${r.name} (${r.id}).`);
    return r;
  });

  setOutput('bucket-name', ref.name);
  setOutput('bucket-id', ref.id);
}

run().catch((err) => fail(err));
