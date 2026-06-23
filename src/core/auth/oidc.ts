/**
 * GitHub OIDC token acquisition.
 *
 * Requires `permissions: { id-token: write }` in the workflow. The returned JWT
 * is a short-lived signed token from `token.actions.githubusercontent.com`.
 */

import * as core from '@actions/core';
import { mask } from '../io/log';

/**
 * Obtain GitHub's signed OIDC JWT for the given audience.
 * Masks the token immediately so it never appears in logs.
 *
 * @param audience optional audience claim; omit to use GitHub's default.
 * @throws when `id-token: write` permission is missing (surfaced by core).
 */
export async function getGithubIdToken(audience?: string): Promise<string> {
  const token = audience === undefined ? await core.getIDToken() : await core.getIDToken(audience);
  if (!token) {
    throw new Error(
      'Failed to obtain a GitHub OIDC token. Ensure the workflow grants ' +
        'permissions: { id-token: write }.',
    );
  }
  mask(token);
  return token;
}
