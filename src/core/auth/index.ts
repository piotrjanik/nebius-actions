/**
 * Auth orchestrator. Two paths to a Nebius IAM token:
 *   - `oidc`: keyless GitHub OIDC -> IAM (federated impersonation).
 *   - `key` : a service-account authorized key (private-key JWT) -> IAM.
 */

import { getGithubIdToken } from './oidc';
import { exchangeForIamToken } from './exchange';
import { exchangeKeyForIamToken } from './key';

export { getGithubIdToken } from './oidc';
export { exchangeForIamToken, type ExchangeParams, type IamToken } from './exchange';
export { exchangeKeyForIamToken, type KeyExchangeParams } from './key';

/** Keyless GitHub OIDC -> IAM via federated impersonation. */
export interface OidcAuthOptions {
  method: 'oidc';
  /** Service account to impersonate via federated credentials (`serviceaccount-…`). */
  serviceAccountId: string;
  /** Optional audience for the GitHub OIDC token request (omit for GitHub's default). */
  audience?: string;
  /** Optional SDK domain override (default: `api.nebius.cloud:443`). */
  domain?: string;
}

/** Service-account authorized key (private-key JWT) -> IAM. */
export interface KeyAuthOptions {
  method: 'key';
  /** Service account the key authenticates as (`serviceaccount-…`). */
  serviceAccountId: string;
  /** The registered public key id (the signed JWT `kid`). */
  publicKeyId: string;
  /** The PEM-encoded private key half of the authorized key. */
  privateKeyPem: string;
  /** Optional SDK domain override (default: `api.nebius.cloud:443`). */
  domain?: string;
}

export type AuthOptions = OidcAuthOptions | KeyAuthOptions;

export interface AuthResult {
  token: string;
  expiresInSeconds: number;
}

/**
 * Authenticate to Nebius and return a (masked) IAM access token.
 *
 * - `oidc`: fetch the GitHub OIDC JWT, then exchange it (SA subject + GitHub
 *   actor) for an IAM token over gRPC via the SDK.
 * - `key` : sign a JWT with the service account's private key and exchange it
 *   for an IAM token over gRPC via the SDK.
 *
 * @throws on unsupported method or any step failure (no silent fallback).
 */
export async function authenticate(o: AuthOptions): Promise<AuthResult> {
  if (!o.serviceAccountId) {
    throw new Error('authenticate: serviceAccountId is required.');
  }

  if (o.method === 'oidc') {
    const idToken = await getGithubIdToken(o.audience);
    const iam = await exchangeForIamToken({
      idToken,
      serviceAccountId: o.serviceAccountId,
      ...(o.domain ? { domain: o.domain } : {}),
    });
    return { token: iam.accessToken, expiresInSeconds: iam.expiresInSeconds };
  }

  if (o.method === 'key') {
    const iam = await exchangeKeyForIamToken({
      serviceAccountId: o.serviceAccountId,
      publicKeyId: o.publicKeyId,
      privateKeyPem: o.privateKeyPem,
      ...(o.domain ? { domain: o.domain } : {}),
    });
    return { token: iam.accessToken, expiresInSeconds: iam.expiresInSeconds };
  }

  throw new Error(
    `Unsupported auth method '${(o as { method: string }).method}'. Use 'oidc' or 'key'.`,
  );
}
