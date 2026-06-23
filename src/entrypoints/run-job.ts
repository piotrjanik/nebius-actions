/**
 * `run-job` action entrypoint (convenience).
 *
 * Creates a Job, then (when `wait`) streams logs and polls to a terminal state,
 * failing the step on a non-success terminal status or timeout.
 */

import {
  buildJobSpecFromInputs,
  createJob,
  ensureCli,
  fail,
  getBool,
  getNumber,
  getJob,
  isJobSuccess,
  isJobTerminal,
  log,
  parseDurationMs,
  pollUntil,
  setOutput,
  streamJobLogs,
  DEFAULT_POLL_TIMEOUT_MS,
  POLL_TIMEOUT_BUFFER_MS,
  type Job,
} from '../core';

async function run(): Promise<void> {
  const wait = getBool('wait', { default: true });
  const pollIntervalSec = getNumber('poll-interval', { default: 10 });
  await ensureCli({ version: 'latest' });

  const spec = buildJobSpecFromInputs();

  // Derive the polling deadline from the Job's own run timeout (e.g. `6h`) plus a
  // buffer, so the action doesn't give up while the job is still legitimately
  // running. Falls back to the default when no/unparseable timeout was given.
  const jobTimeoutMs = parseDurationMs(spec.timeout);
  const pollTimeoutMs =
    jobTimeoutMs !== undefined ? jobTimeoutMs + POLL_TIMEOUT_BUFFER_MS : DEFAULT_POLL_TIMEOUT_MS;

  const created = await log.group('Create job', async () => {
    const job = await createJob(spec);
    log.info(`Created job ${job.id} (status: ${job.status}).`);
    return job;
  });

  setOutput('job-id', created.id);
  setOutput('status', created.status);

  if (!wait) {
    log.info('wait=false: returning immediately after creation.');
    return;
  }

  // Stream logs best-effort alongside polling (the CLI follows until terminal).
  streamJobLogs(created.id).catch((err) => {
    log.warn(`Log streaming stopped: ${err instanceof Error ? err.message : String(err)}`);
  });

  const { value: finalJob, timedOut } = await pollUntil<Job>({
    fn: () => getJob(created.id),
    isTerminal: (j) => isJobTerminal(j.status),
    timeoutMs: pollTimeoutMs,
    intervalMs: Math.max(0, pollIntervalSec) * 1000,
    onTick: (j) => log.info(`job ${j.id}: ${j.status}`),
  });

  setOutput('status', finalJob.status);
  if (finalJob.exitCode !== undefined) {
    setOutput('exit-code', finalJob.exitCode);
  }

  if (timedOut) {
    throw new Error(`Timed out waiting for job ${created.id}; last status: ${finalJob.status}.`);
  }
  if (!isJobSuccess(finalJob.status)) {
    throw new Error(
      `Job ${created.id} finished with non-success status '${finalJob.status}'` +
        (finalJob.exitCode !== undefined ? ` (exit code ${finalJob.exitCode}).` : '.'),
    );
  }
  log.info(`Job ${created.id} completed successfully.`);
}

run().catch((err) => fail(err));
