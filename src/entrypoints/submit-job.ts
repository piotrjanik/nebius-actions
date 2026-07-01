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
  resolveSubnetId,
  subnetService,
  fail,
  log,
  setOutput,
} from '../core';

async function run(): Promise<void> {
  const spec = buildJobSpecFromInputs();
  const sdk = createSdk();
  try {
    const service = jobService(sdk);
    const job = await log.group('Create job', async () => {
      // The SDK requires a subnet; resolve the project's first subnet when the
      // caller did not pass one explicitly.
      if (!spec.subnetId) {
        spec.subnetId = await resolveSubnetId(subnetService(sdk), spec.projectId ?? '');
        log.info(`Using subnet ${spec.subnetId}.`);
      }
      const j = await createJobViaSdk(service, spec);
      log.info(`Created job ${j.id} (status: ${j.status}).`);
      return j;
    });
    setOutput('job-id', job.id);
    setOutput('status', job.status);
  } finally {
    await sdk.close();
  }
}

run().catch((err) => fail(err));
