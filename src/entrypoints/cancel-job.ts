/**
 * `cancel-job` action entrypoint (low-level).
 *
 * Cancels a running Job via the SDK `JobService`. Requires the `auth` action
 * to have exported NEBIUS_IAM_TOKEN.
 */

import { cancelJob, createSdk, fail, getString, jobService, log, setOutput } from '../core';

async function run(): Promise<void> {
  const jobId = getString('job-id', { required: true });

  const sdk = createSdk();
  try {
    const service = jobService(sdk);
    const job = await log.group('Cancel job', async () => {
      const j = await cancelJob(service, jobId);
      log.info(`Cancelled job ${jobId} (status: ${j.status}).`);
      return j;
    });

    setOutput('status', job.status);
  } finally {
    await sdk.close();
  }
}

run().catch((err) => fail(err));
