/**
 * Make the IAM token available to the CLI and to downstream workflow steps.
 *
 * The CLI/SDK read the token from the `NEBIUS_IAM_TOKEN` env var (CONFIRMED
 * 2026-06-22). We:
 *   1. set it for THIS process (so subsequent runCli calls in the same step
 *      authenticate), and
 *   2. export it via core.exportVariable so downstream steps inherit it.
 *
 * The token must already be masked by the caller (auth flow does this).
 */

import * as core from '@actions/core';
import { mask } from '../io/log';
import { IAM_TOKEN_ENV } from '../constants';

/**
 * Export the IAM token to the environment for the CLI + downstream steps.
 * @throws when `token` is empty (a missing token is never silently ignored).
 */
export async function configureCliAuth(token: string): Promise<void> {
  if (!token) {
    throw new Error('configureCliAuth: token is required.');
  }
  mask(token);
  // Available to other steps in the job (writes to $GITHUB_ENV).
  core.exportVariable(IAM_TOKEN_ENV, token);
  // Available to runCli calls within THIS step/process immediately.
  process.env[IAM_TOKEN_ENV] = token;
}
