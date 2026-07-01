/**
 * Adapter from GitHub Actions inputs to a `JobSpec`.
 *
 * Shared by the `run-job` and `submit-job` entrypoints, which accept the same
 * job inputs and create the job via the SDK (`jobs-sdk.ts`). The SDK takes a
 * structured spec, so there is no raw `extra-args` passthrough — disk size,
 * disk type, preemptible, and container args are first-class inputs.
 */

import {
  getString,
  getStringOrEnv,
  getBool,
  getMultiline,
  getKeyValues,
} from '../io/inputs';
import { PROJECT_ID_ENV } from '../constants';
import { parseSizeBytes } from '../size';
import type { JobSpec } from './jobs';

/** Read the standard job inputs and assemble a `JobSpec` (image is required). */
export function buildJobSpecFromInputs(): JobSpec {
  const image = getString('image', { required: true });
  const name = getString('name');
  const command = getMultiline('command');
  const args = getString('args');
  const preset = getString('preset');
  const platform = getString('platform');
  const env = getKeyValues('env');
  const mounts = getMultiline('mounts');
  const timeout = getString('timeout');
  const diskSize = getString('disk-size');
  const diskType = getString('disk-type');
  const subnetId = getString('subnet-id');
  const preemptible = getBool('preemptible', { default: false });
  // Optional: falls back to NEBIUS_PROJECT_ID (exported by setup); when neither
  // is set, parentId is omitted and the API uses the token's default project.
  const projectId = getStringOrEnv('project-id', PROJECT_ID_ENV);

  const spec: JobSpec = { image, preemptible };
  if (name) spec.name = name;
  if (command.length > 0) spec.command = command;
  if (args) spec.args = args;
  if (preset) spec.preset = preset;
  if (platform) spec.platform = platform;
  if (Object.keys(env).length > 0) spec.env = env;
  if (mounts.length > 0) spec.mounts = mounts;
  if (timeout) spec.timeout = timeout;
  if (diskSize) spec.diskSizeBytes = parseSizeBytes(diskSize);
  if (diskType) spec.diskType = diskType;
  if (subnetId) spec.subnetId = subnetId;
  if (projectId) spec.projectId = projectId;
  return spec;
}
