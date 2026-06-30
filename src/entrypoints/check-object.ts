/**
 * `check-object` action entrypoint.
 *
 * Verifies that at least one object exists under a bucket prefix; FAILS the
 * action when none are found (the "model trained" gate).
 */

import { ensureCli, fail, log, setOutput } from '../core';
import { buildCheckSpecFromInputs, checkObject } from '../core/storage/check';

async function run(): Promise<void> {
  await ensureCli({ version: 'latest' });
  const spec = buildCheckSpecFromInputs();

  const count = await log.group('Check object', async () => {
    const n = await checkObject(spec);
    log.info(`Found ${n} object(s) under '${spec.prefix}' in ${spec.bucket}.`);
    return n;
  });

  if (count === 0) {
    throw new Error(`No objects under prefix '${spec.prefix}' in bucket '${spec.bucket}' — verification failed.`);
  }
  setOutput('object-count', count);
}

run().catch((err) => fail(err));
