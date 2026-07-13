/**
 * `delete-bucket` action entrypoint.
 *
 * Empties the bucket over S3 (so the delete works even if the API refuses
 * non-empty buckets), then deletes the bucket via the SDK `BucketService`.
 * Requires the `auth` action to have exported NEBIUS_IAM_TOKEN.
 */

import { bucketService, createSdk, fail, keyServices, log, setOutput, getString } from '../core';
import { buildEmptySpecFromInputs, emptyBucket } from '../core/storage/empty';
import { deleteBucket } from '../core/storage/bucket';

async function run(): Promise<void> {
  const bucketId = getString('bucket-id', { required: true });
  const spec = buildEmptySpecFromInputs();

  const sdk = createSdk();
  try {
    const deleted = await log.group('Delete bucket', async () => {
      const n = await emptyBucket(keyServices(sdk), spec);
      log.info(`Emptied ${n} object(s) from ${spec.bucket}.`);
      await deleteBucket(bucketService(sdk), bucketId);
      log.info(`Deleted bucket ${bucketId}.`);
      return n;
    });

    setOutput('deleted-count', deleted);
  } finally {
    await sdk.close();
  }
}

run().catch((err) => fail(err));
