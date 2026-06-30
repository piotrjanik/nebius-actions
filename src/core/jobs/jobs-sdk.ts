/**
 * Job creation over the `@nebius/js-sdk` `JobService` gRPC API (`nebius.ai.v1`).
 *
 * Mirrors the endpoints domain: pure builders map the domain `JobSpec` onto the
 * SDK `JobSpec`, and the single I/O function takes an injected `JobServiceLike`
 * so it is unit-testable with a fake (no SDK construction, no network).
 *
 * `create` returns a long-running Operation, not the Job — the new job id is
 * `op.resourceId()`. We return it with an initial `CREATING` status; the real
 * state is polled later by `wait-for-job` (still CLI-backed).
 *
 * Notes (verified against @nebius/js-sdk 0.2.27):
 *   - Proto `.create()` factories accept `DeepPartial`; a `Long` field accepts a
 *     plain `number`, so `disk.sizeBytes` is set as bytes directly.
 *   - `timeout` is a dayjs `Duration` (`dayjs.duration(ms)`).
 *   - Enum fields take SDK enum members (`JobSpec_VolumeMount_Mode.*`,
 *     `DiskSpec_DiskType.*`), not raw strings.
 */

import {
  CreateJobRequest,
  JobSpec as SdkJobSpec,
  JobSpec_VolumeMount_Mode,
} from '@nebius/js-sdk/api/nebius/ai/v1/index';
import { DiskSpec_DiskType } from '@nebius/js-sdk/api/nebius/compute/v1/index';
import { dayjs } from '@nebius/js-sdk/runtime/protos/index';
import { parseDurationMs } from '../time';
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
}

/** Map the `disk-type` input key onto the SDK disk-type enum. */
const DISK_TYPES: Record<string, DiskSpec_DiskType> = {
  'network-ssd': DiskSpec_DiskType.NETWORK_SSD,
  'network-hdd': DiskSpec_DiskType.NETWORK_HDD,
  'network-ssd-non-replicated': DiskSpec_DiskType.NETWORK_SSD_NON_REPLICATED,
  'network-ssd-io-m3': DiskSpec_DiskType.NETWORK_SSD_IO_M3,
};

/**
 * Parse a `<source>:<containerPath>[:rw|ro]` mount string.
 * VERIFY: the SDK `VolumeMount.source` accepts a bucket id directly (the CLI
 * `--volume <bucket-id>:/path:rw` did). Defaults to read-write.
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
    const typeKey = (s.diskType ?? 'network-ssd').toLowerCase();
    const type = DISK_TYPES[typeKey];
    if (type === undefined) {
      throw new Error(`buildJobSpec: unknown disk type '${s.diskType}'.`);
    }
    spec.disk = { sizeBytes: s.diskSizeBytes, type };
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
