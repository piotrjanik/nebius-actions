/**
 * `cancel-job` action entrypoint (low-level).
 *
 * Cancels a running Job.
 */

import { cancelJob, ensureCli, fail, getString, log, setOutput } from '../core';

async function run(): Promise<void> {
  const jobId = getString('job-id', { required: true });
  await ensureCli({ version: 'latest' });

  const job = await log.group('Cancel job', async () => {
    const j = await cancelJob(jobId);
    log.info(`Cancelled job ${jobId} (status: ${j.status}).`);
    return j;
  });

  setOutput('status', job.status);
}

run().catch((err) => fail(err));
