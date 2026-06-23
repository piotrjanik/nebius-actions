/**
 * `wait-for-job` action entrypoint (low-level).
 *
 * Polls an existing Job until terminal; optionally streams logs. Fails on a
 * non-success terminal status or timeout.
 */

import {
  ensureCli,
  fail,
  getBool,
  getNumber,
  getString,
  getJob,
  isJobSuccess,
  isJobTerminal,
  log,
  pollUntil,
  setOutput,
  streamJobLogs,
  type Job,
} from '../core';

async function run(): Promise<void> {
  const jobId = getString('job-id', { required: true });
  const pollIntervalSec = getNumber('poll-interval', { default: 10 });
  const timeoutSec = getNumber('timeout', { default: 60 * 60 });
  const streamLogs = getBool('stream-logs', { default: true });

  await ensureCli({ version: 'latest' });

  if (streamLogs) {
    streamJobLogs(jobId).catch((err) => {
      log.warn(`Log streaming stopped: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  const { value: finalJob, timedOut } = await pollUntil<Job>({
    fn: () => getJob(jobId),
    isTerminal: (j) => isJobTerminal(j.status),
    timeoutMs: Math.max(0, timeoutSec) * 1000,
    intervalMs: Math.max(0, pollIntervalSec) * 1000,
    onTick: (j) => log.info(`job ${j.id}: ${j.status}`),
  });

  setOutput('status', finalJob.status);
  if (finalJob.exitCode !== undefined) {
    setOutput('exit-code', finalJob.exitCode);
  }

  if (timedOut) {
    throw new Error(`Timed out waiting for job ${jobId}; last status: ${finalJob.status}.`);
  }
  if (!isJobSuccess(finalJob.status)) {
    throw new Error(
      `Job ${jobId} finished with non-success status '${finalJob.status}'` +
        (finalJob.exitCode !== undefined ? ` (exit code ${finalJob.exitCode}).` : '.'),
    );
  }
  log.info(`Job ${jobId} completed successfully.`);
}

run().catch((err) => fail(err));
