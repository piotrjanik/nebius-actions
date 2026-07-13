/**
 * `create-bucket` action entrypoint (control plane; no aws-sdk).
 *
 * Creates the bucket via the SDK `BucketService`. Requires the `auth` action
 * to have exported NEBIUS_IAM_TOKEN. Imports bucket helpers from the storage
 * subpath (not the ../core/storage barrel) so this action's bundle stays free
 * of @aws-sdk/client-s3.
 */

import {
  bucketService,
  createSdk,
  fail,
  log,
  setOutput,
  getString,
  getStringOrEnv,
  PROJECT_ID_ENV,
} from '../core';
import { createBucket } from '../core/storage/bucket';

async function run(): Promise<void> {
  const name = getString('name', { required: true });
  const projectId = getStringOrEnv('project-id', PROJECT_ID_ENV, { required: true });
  const maxSizeBytes = getString('max-size-bytes');

  const sdk = createSdk();
  try {
    const service = bucketService(sdk);
    const ref = await log.group('Create bucket', async () => {
      const r = await createBucket(service, {
        name,
        projectId,
        ...(maxSizeBytes ? { maxSizeBytes } : {}),
      });
      log.info(`Created bucket ${r.name} (${r.id}).`);
      return r;
    });

    setOutput('bucket-name', ref.name);
    setOutput('bucket-id', ref.id);
  } finally {
    await sdk.close();
  }
}

run().catch((err) => fail(err));
