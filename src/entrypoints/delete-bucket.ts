/**
 * `delete-bucket` action entrypoint.
 *
 * Empties the bucket over S3 (so the CLI delete works even if it refuses
 * non-empty buckets), then deletes the bucket via the control-plane CLI.
 */

import { ensureCli, fail, log, setOutput, getString } from '../core';
import { buildEmptySpecFromInputs, emptyBucket } from '../core/storage/empty';
import { deleteBucket } from '../core/storage/bucket';

async function run(): Promise<void> {
  await ensureCli({ version: 'latest' });
  const bucketId = getString('bucket-id', { required: true });
  const spec = buildEmptySpecFromInputs();

  const deleted = await log.group('Delete bucket', async () => {
    const n = await emptyBucket(spec);
    log.info(`Emptied ${n} object(s) from ${spec.bucket}.`);
    await deleteBucket(bucketId);
    log.info(`Deleted bucket ${bucketId}.`);
    return n;
  });

  setOutput('deleted-count', deleted);
}

run().catch((err) => fail(err));
