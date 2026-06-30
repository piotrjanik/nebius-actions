/**
 * Job domain wrappers over the `nebius ai job` CLI group.
 *
 * Arg-building is split into pure functions (`buildCreateJobArgs`) so it can be
 * unit-tested without invoking the CLI. CLI JSON is mapped into the typed `Job`
 * shape via `mapJobJson`; status helpers are case-insensitive to tolerate enum
 * casing differences (see constants VERIFY notes).
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

/**
 * Build `nebius ai job create ...` args from a spec (pure).
 *
 * Flag names CONFIRMED against the live `nebius ai job create` CLI:
 *   --name --image --container-command --preset --platform --env --timeout
 *   --volume (mounts) and --parent-id (the project/parent the job is created in).
 * `extraArgs` is raw passthrough appended last so users can reach unmapped flags.
 */
export function buildCreateJobArgs(s: JobSpec): string[] {
  if (!s.image) {
    throw new Error('JobSpec.image is required.');
  }
  const args = [...JOB, 'create'];

  if (s.name) {
    args.push('--name', s.name);
  }
  args.push('--image', s.image);
  if (s.preset) {
    args.push('--preset', s.preset);
  }
  if (s.platform) {
    args.push('--platform', s.platform);
  }
  if (s.projectId) {
    args.push('--parent-id', s.projectId);
  }
  if (s.timeout) {
    args.push('--timeout', s.timeout);
  }
  if (s.env) {
    for (const [k, v] of Object.entries(s.env)) {
      args.push('--env', `${k}=${v}`);
    }
  }
  // Mounts map to `--volume` (e.g. `<bucket-id>:/data:rw`), the flag the live CLI
  // accepts; `--mount` does not exist. A bucket mounted by id needs no S3
  // credentials — Nebius resolves access from the job's service account.
  if (s.mounts) {
    for (const m of s.mounts) {
      args.push('--volume', m);
    }
  }
  // Container command/args are passed via --container-command (CONFIRMED flag).
  if (s.command && s.command.length > 0) {
    args.push('--container-command', s.command.join(' '));
  }
  if (s.extraArgs && s.extraArgs.length > 0) {
    args.push(...s.extraArgs);
  }
  return args;
}

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

/** Create a job. */
export async function createJob(s: JobSpec): Promise<Job> {
  const res = await runCli(buildCreateJobArgs(s), { json: true });
  return mapJobJson(res.data);
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
