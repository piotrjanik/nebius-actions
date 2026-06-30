/**
 * Job domain wrappers over the `nebius ai job` CLI group.
 *
 * CLI JSON is mapped into the typed `Job` shape via `mapJobJson`; status
 * helpers are case-insensitive to tolerate enum casing differences (see
 * constants VERIFY notes). Job creation goes through the SDK (see jobs-sdk.ts).
 */

import { runCli } from '../cli/exec';
import { log } from '../io/log';
import { readPath, firstString } from '../json';
import {
  CLI_JOB_GROUP,
  JOB_TERMINAL_STATUSES,
  JOB_SUCCESS_STATUSES,
  JOB_EXIT_CODE_FIELDS,
} from '../constants';

export interface JobSpec {
  name?: string;
  image: string;
  command?: string[];
  /** Container args string (e.g. `-c "axolotl train …"`); SDK `args`. */
  args?: string;
  preset?: string;
  platform?: string;
  env?: Record<string, string>;
  mounts?: string[];
  timeout?: string;
  /** Main-disk size in bytes; when set, the SDK `disk` block is built. */
  diskSizeBytes?: number;
  /** Disk type key (e.g. `network-ssd`); mapped to the SDK disk-type enum. */
  diskType?: string;
  /** Run the job on preemptible compute. */
  preemptible?: boolean;
  projectId?: string;
}

export interface Job {
  id: string;
  name?: string;
  status: string;
  exitCode?: number;
  raw: unknown;
}

const JOB = [...CLI_JOB_GROUP];

/** Extract the container exit code from candidate JSON paths. */
function extractExitCode(obj: Record<string, unknown>): number | undefined {
  for (const path of JOB_EXIT_CODE_FIELDS) {
    const v = readPath(obj, path);
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

/**
 * Map CLI JSON for a single job into the typed `Job`.
 * // VERIFY: exact field names (`metadata.id`, `status.state`, etc.). We probe
 * the most likely paths and keep the full payload in `raw`.
 */
export function mapJobJson(raw: unknown): Job {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const id =
    firstString(obj, ['id', 'metadata.id', 'job_id', 'jobId', 'name', 'metadata.name']) ?? '';
  const name = firstString(obj, ['name', 'metadata.name', 'spec.name']);
  const status =
    firstString(obj, ['status', 'state', 'status.state', 'status.phase', 'status.status']) ??
    'UNKNOWN';
  const exitCode = extractExitCode(obj);

  const job: Job = { id, status, raw };
  if (name !== undefined) {
    job.name = name;
  }
  if (exitCode !== undefined) {
    job.exitCode = exitCode;
  }
  return job;
}

/** Get a job by id. */
export async function getJob(id: string): Promise<Job> {
  if (!id) {
    throw new Error('getJob: id is required.');
  }
  const res = await runCli([...JOB, 'get', '--id', id], { json: true });
  return mapJobJson(res.data);
}

/** Cancel a job by id. */
export async function cancelJob(id: string): Promise<Job> {
  if (!id) {
    throw new Error('cancelJob: id is required.');
  }
  const res = await runCli([...JOB, 'cancel', '--id', id], { json: true });
  // Some verbs return an operation rather than the job; fall back to a fresh get.
  const mapped = mapJobJson(res.data);
  if (mapped.id) {
    return mapped;
  }
  return getJob(id);
}

/**
 * Stream a job's logs to the action log. Inherits stdout (no JSON parsing).
 * `nebius ai job logs --id <id>` prints the logs; the live CLI exposes no
 * `--follow` flag, and run-job calls this only once the job is terminal anyway.
 */
export async function streamJobLogs(id: string): Promise<void> {
  if (!id) {
    throw new Error('streamJobLogs: id is required.');
  }
  await log.group(`job ${id} logs`, async () => {
    await runCli([...JOB, 'logs', '--id', id]);
  });
}

/** True when the status is terminal (case-insensitive). */
export function isJobTerminal(status: string): boolean {
  return JOB_TERMINAL_STATUSES.has(status.trim().toUpperCase());
}

/** True when the status is a success (case-insensitive). */
export function isJobSuccess(status: string): boolean {
  return JOB_SUCCESS_STATUSES.has(status.trim().toUpperCase());
}
