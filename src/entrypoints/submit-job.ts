/**
 * `submit-job` action entrypoint (low-level).
 *
 * Creates a Job via the SDK `JobService` and returns immediately (no waiting).
 * Requires the `auth` action to have exported NEBIUS_IAM_TOKEN.
 */

import {
  buildJobSpecFromInputs,
  createJobViaSdk,
  createSdk,
  jobService,
  fail,
  log,
  setOutput,
} from '../core';

async function run(): Promise<void> {
  const spec = buildJobSpecFromInputs();
  const service = jobService(createSdk());

  const job = await log.group('Create job', async () => {
    const j = await createJobViaSdk(service, spec);
    log.info(`Created job ${j.id} (status: ${j.status}).`);
    return j;
  });

  setOutput('job-id', job.id);
  setOutput('status', job.status);
}

run().catch((err) => fail(err));
