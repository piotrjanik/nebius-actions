/**
 * Adapter from GitHub Actions inputs to a `JobSpec`.
 *
 * Shared by the `run-job` and `submit-job` entrypoints, which accept the same
 * set of job inputs. Kept here (next to the job domain) so the two entrypoints
 * stay thin and cannot drift apart.
 */

import { getString, getMultiline, getKeyValues } from '../io/inputs';
import type { JobSpec } from './jobs';

/** Read the standard job inputs and assemble a `JobSpec` (image is required). */
export function buildJobSpecFromInputs(): JobSpec {
  const image = getString('image', { required: true });
  const name = getString('name');
  const command = getMultiline('command');
  const preset = getString('preset');
  const platform = getString('platform');
  const env = getKeyValues('env');
  const mounts = getMultiline('mounts');
  const timeout = getString('timeout');
  const projectId = getString('project-id');
  const extraArgs = getMultiline('extra-args');

  const spec: JobSpec = { image };
  if (name) spec.name = name;
  if (command.length > 0) spec.command = command;
  if (preset) spec.preset = preset;
  if (platform) spec.platform = platform;
  if (Object.keys(env).length > 0) spec.env = env;
  if (mounts.length > 0) spec.mounts = mounts;
  if (timeout) spec.timeout = timeout;
  if (projectId) spec.projectId = projectId;
  if (extraArgs.length > 0) spec.extraArgs = extraArgs;
  return spec;
}
