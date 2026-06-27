/**
 * Auth orchestrator: GitHub OIDC -> Nebius IAM token (keyless, federated).
 */

import { getGithubIdToken } from './oidc';
import { exchangeForIamToken } from './exchange';

export { getGithubIdToken } from './oidc';
export { exchangeForIamToken, type ExchangeParams, type IamToken } from './exchange';

export interface AuthOptions {
  /** Only `oidc` is implemented in v1 (extensible enum; spec §10). */
  method: 'oidc';
  /** Service account to impersonate via federated credentials (`serviceaccount-…`). */
  serviceAccountId: string;
  /** Optional audience for the GitHub OIDC token request (omit for GitHub's default). */
  audience?: string;
  /** Optional SDK domain override (default: `api.nebius.cloud:443`). */
  domain?: string;
}

export interface AuthResult {
  token: string;
  expiresInSeconds: number;
}

/**
 * Run the full keyless federated auth flow:
 *   1. fetch the GitHub OIDC JWT (masked),
 *   2. exchange it (delegation: SA subject + GitHub actor) for a Nebius IAM
 *      access token over gRPC via the Nebius SDK (masked).
 *
 * @throws on unsupported method or any step failure (no silent fallback).
 */
export async function authenticate(o: AuthOptions): Promise<AuthResult> {
  if (o.method !== 'oidc') {
    throw new Error(`Unsupported auth method '${o.method}'. Only 'oidc' is supported in v1.`);
  }
  if (!o.serviceAccountId) {
    throw new Error('authenticate: serviceAccountId is required for the federated OIDC flow.');
  }
  const idToken = await getGithubIdToken(o.audience);
  const iam = await exchangeForIamToken({
    idToken,
    serviceAccountId: o.serviceAccountId,
    ...(o.domain ? { domain: o.domain } : {}),
  });
  return { token: iam.accessToken, expiresInSeconds: iam.expiresInSeconds };
}
