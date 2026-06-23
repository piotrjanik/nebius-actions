/**
 * `submit-job` action entrypoint (low-level).
 *
 * Creates a Job and returns immediately (no waiting).
 */

import {
  buildJobSpecFromInputs,
  createJob,
  ensureCli,
  fail,
  log,
  setOutput,
} from '../core';

async function run(): Promise<void> {
  await ensureCli({ version: 'latest' });
  const spec = buildJobSpecFromInputs();

  const job = await log.group('Create job', async () => {
    const j = await createJob(spec);
    log.info(`Created job ${j.id} (status: ${j.status}).`);
    return j;
  });

  setOutput('job-id', job.id);
  setOutput('status', job.status);
}

run().catch((err) => fail(err));
