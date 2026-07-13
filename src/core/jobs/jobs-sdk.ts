/**
 * Job lifecycle over the `@nebius/js-sdk` `JobService` gRPC API (`nebius.ai.v1`).
 *
 * Mirrors the endpoints domain: pure builders map the domain `JobSpec` onto the
 * SDK `JobSpec`, and the I/O functions take an injected `JobServiceLike` so they
 * are unit-testable with a fake (no SDK construction, no network).
 *
 * `create`/`cancel` return a long-running Operation, not the Job — the new job
 * id is `op.resourceId()`. Create returns immediately with an initial
 * `CREATING` placeholder status; the real state is polled via `getJob`.
 *
 * Notes (verified against @nebius/js-sdk 0.2.27):
 *   - Proto `.create()` factories accept `DeepPartial`; a `Long` field accepts a
 *     plain `number`, so `disk.sizeBytes` is set as bytes directly.
 *   - `timeout` is a dayjs `Duration` (`dayjs.duration(ms)`).
 *   - Enum fields take SDK enum members (`JobSpec_VolumeMount_Mode.*`,
 *     `DiskSpec_DiskType.*`), not raw strings.
 *   - The Job status carries no container exit code, so `Job.exitCode` stays
 *     unset on the SDK path.
 */

import {
  CancelJobRequest,
  CreateJobRequest,
  GetJobRequest,
  JobSpec as SdkJobSpec,
  JobSpec_VolumeMount_Mode,
} from '@nebius/js-sdk/api/nebius/ai/v1/index';
import { DiskSpec_DiskType } from '@nebius/js-sdk/api/nebius/compute/v1/index';
import { ListSubnetsRequest } from '@nebius/js-sdk/api/nebius/vpc/v1/index';
import { dayjs } from '@nebius/js-sdk/runtime/protos/index';
import { parseDurationMs } from '../time';
import { resolveDiskType } from '../sdk/disk';
import { readState } from '../sdk/state';
import { JOB_STATUS } from '../constants';
import type { Job, JobSpec } from './jobs';

/** Minimal Operation surface used here (satisfied by the SDK's Operation). */
export interface OperationLike {
  resourceId(): string;
  raw?(): unknown;
}

/** Minimal Job service surface (satisfied by the SDK's `JobService`). */
export interface JobServiceLike {
  create(req: CreateJobRequest): { result: Promise<OperationLike> };
  get(req: GetJobRequest): PromiseLike<unknown>;
  cancel(req: CancelJobRequest): { result: Promise<OperationLike> };
}

/** Minimal Subnet service surface (satisfied by the SDK's `SubnetService`). */
export interface SubnetServiceLike {
  list(req: ListSubnetsRequest): PromiseLike<{
    items?: { metadata?: { id?: string } }[];
  }>;
}

/**
 * Resolve a subnet id for the job's project by listing the project's subnets and
 * taking the first. The SDK requires `JobSpec.subnetId` (the CLI resolved it
 * implicitly); this reproduces that so callers need not supply one. Callers may
 * still pass an explicit `subnet-id` to skip this.
 * @throws when no project id is available or the project has no subnets.
 */
export async function resolveSubnetId(
  service: SubnetServiceLike,
  projectId: string,
): Promise<string> {
  if (!projectId) {
    throw new Error(
      'resolveSubnetId: a project id is required to look up a subnet — set project-id (or pass subnet-id explicitly).',
    );
  }
  const res = await service.list(ListSubnetsRequest.create({ parentId: projectId }));
  const id = res.items?.[0]?.metadata?.id;
  if (!id) {
    throw new Error(
      `resolveSubnetId: no subnets found in project '${projectId}' — pass subnet-id explicitly.`,
    );
  }
  return id;
}

/**
 * Parse a `<source>:<containerPath>[:rw|ro]` mount string.
 * Confirmed (SDK 0.2.27): `VolumeMount.source` accepts a bucket name or id
 * directly, as well as an S3 URI. Defaults to read-write.
 */
export function parseMount(m: string): {
  source: string;
  containerPath: string;
  mode: JobSpec_VolumeMount_Mode;
} {
  const parts = m.split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`parseMount: malformed mount '${m}' (expected <source>:/path[:rw|ro]).`);
  }
  const [source, containerPath, modeRaw] = parts;
  const mode =
    (modeRaw ?? 'rw').toLowerCase() === 'ro'
      ? JobSpec_VolumeMount_Mode.READ_ONLY
      : JobSpec_VolumeMount_Mode.READ_WRITE;
  return { source, containerPath, mode };
}

/** Build the SDK `ResourceMetadata` partial (pure). */
export function buildJobMetadata(s: JobSpec): { name?: string; parentId?: string } {
  return {
    ...(s.name ? { name: s.name } : {}),
    ...(s.projectId ? { parentId: s.projectId } : {}),
  };
}

interface SdkJobSpecPartial {
  image: string;
  containerCommand?: string;
  args?: string;
  preset?: string;
  platform?: string;
  preemptible?: boolean;
  subnetId?: string;
  environmentVariables?: { name: string; value: string }[];
  volumes?: { source: string; containerPath: string; mode: JobSpec_VolumeMount_Mode }[];
  timeout?: ReturnType<typeof dayjs.duration>;
  disk?: { sizeBytes: number; type: DiskSpec_DiskType };
}

/** Build the SDK `JobSpec` partial from a domain spec (pure). */
export function buildJobSpec(s: JobSpec): SdkJobSpecPartial {
  if (!s.image) {
    throw new Error('JobSpec.image is required.');
  }
  const spec: SdkJobSpecPartial = { image: s.image };

  if (s.command && s.command.length > 0) spec.containerCommand = s.command.join(' ');
  if (s.args) spec.args = s.args;
  if (s.preset) spec.preset = s.preset;
  if (s.platform) spec.platform = s.platform;
  if (s.preemptible) spec.preemptible = true;
  if (s.subnetId) spec.subnetId = s.subnetId;

  const env = Object.entries(s.env ?? {});
  if (env.length > 0) {
    spec.environmentVariables = env.map(([name, value]) => ({ name, value }));
  }
  if (s.mounts && s.mounts.length > 0) {
    spec.volumes = s.mounts.map(parseMount);
  }
  const timeoutMs = parseDurationMs(s.timeout);
  if (timeoutMs !== undefined) {
    spec.timeout = dayjs.duration(timeoutMs);
  }
  if (s.diskSizeBytes !== undefined) {
    spec.disk = { sizeBytes: s.diskSizeBytes, type: resolveDiskType(s.diskType) };
  }
  return spec;
}

/** Assemble the `CreateJobRequest` (pure). */
export function buildCreateJobRequest(s: JobSpec): CreateJobRequest {
  return CreateJobRequest.create({
    metadata: buildJobMetadata(s),
    spec: SdkJobSpec.create(buildJobSpec(s)),
  });
}

/** Create a job via the SDK; returns immediately with the new id + CREATING. */
export async function createJobViaSdk(service: JobServiceLike, s: JobSpec): Promise<Job> {
  const op = await service.create(buildCreateJobRequest(s)).result;
  return { id: op.resourceId(), status: JOB_STATUS.creating, raw: op.raw?.() ?? op };
}

/**
 * Map an SDK `Job` (or a plain object in tests) into the domain `Job`.
 * Reads id/name from `metadata` and the status string from `status.state`
 * (enum `.name`).
 */
export function mapSdkJob(raw: unknown): Job {
  const j = (raw ?? {}) as { metadata?: { id?: string; name?: string } };
  const id = j.metadata?.id ?? '';
  const name = j.metadata?.name;
  const status = readState((j as { status?: unknown }).status);

  const job: Job = { id, status, raw };
  if (name !== undefined && name !== '') {
    job.name = name;
  }
  return job;
}

/** Get a job by id. */
export async function getJob(service: JobServiceLike, id: string): Promise<Job> {
  if (!id) {
    throw new Error('getJob: id is required.');
  }
  const job = await service.get(GetJobRequest.create({ id }));
  return mapSdkJob(job);
}

/**
 * Cancel a job by id. Cancel returns an Operation (not the Job), so the job is
 * re-fetched afterwards to report its current status.
 */
export async function cancelJob(service: JobServiceLike, id: string): Promise<Job> {
  if (!id) {
    throw new Error('cancelJob: id is required.');
  }
  await service.cancel(CancelJobRequest.create({ id })).result;
  return getJob(service, id);
}
