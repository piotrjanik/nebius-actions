/**
 * Job domain: shared types, status helpers, and CLI-backed log streaming.
 *
 * The Job lifecycle (create/get/cancel) goes through the SDK `JobService` —
 * see jobs-sdk.ts. The ONLY remaining CLI dependency is `streamJobLogs`:
 * the AI service exposes no logs RPC, so log streaming shells out to
 * `nebius ai job logs --follow` when the CLI is on PATH (i.e. the `setup`
 * action ran) and is skipped with a notice otherwise.
 */

import { cliAvailable, runCli } from '../cli/exec';
import { log } from '../io/log';
import { CLI_JOB_GROUP, JOB_TERMINAL_STATUSES, JOB_SUCCESS_STATUSES } from '../constants';

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
  /** Subnet the job runs in; when unset it is resolved from the project. */
  subnetId?: string;
  projectId?: string;
}

export interface Job {
  id: string;
  name?: string;
  status: string;
  /** Container exit code — not exposed by the SDK Job status; kept for shape stability. */
  exitCode?: number;
  raw: unknown;
}

const JOB = [...CLI_JOB_GROUP];

/**
 * Stream a job's logs to the action log. Inherits stdout (no JSON parsing).
 * Runs `nebius ai job logs <id> --follow` — the id is POSITIONAL here, and
 * `--follow` streams in real time until the job reaches a terminal state.
 * Callers invoke this fire-and-forget alongside the status poll loop.
 */
export async function streamJobLogs(id: string): Promise<void> {
  if (!id) {
    throw new Error('streamJobLogs: id is required.');
  }
  await log.group(`job ${id} logs`, async () => {
    await runCli([...JOB, 'logs', id, '--follow']);
  });
}

/**
 * Best-effort log streaming for entrypoints: streams via the CLI when it is on
 * PATH, otherwise logs a notice and returns (status polling still reports
 * progress). Never throws — a log-stream hiccup must not fail the action.
 */
export async function maybeStreamJobLogs(id: string): Promise<void> {
  if (!(await cliAvailable())) {
    log.info(
      'nebius CLI not found on PATH — skipping log streaming ' +
        "(run the 'setup' action first to enable it).",
    );
    return;
  }
  try {
    await streamJobLogs(id);
  } catch (err) {
    log.warn(`Log streaming stopped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** True when the status is terminal (case-insensitive). */
export function isJobTerminal(status: string): boolean {
  return JOB_TERMINAL_STATUSES.has(status.trim().toUpperCase());
}

/** True when the status is a success (case-insensitive). */
export function isJobSuccess(status: string): boolean {
  return JOB_SUCCESS_STATUSES.has(status.trim().toUpperCase());
}
