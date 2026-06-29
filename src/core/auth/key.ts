/**
 * Service-account key auth via the official Nebius JS SDK (`@nebius/js-sdk`).
 *
 * The non-keyless alternative to the federated OIDC flow (`exchange.ts`): instead
 * of impersonating a service account with a GitHub OIDC actor token, we present
 * the service account's own authorized key (an RSA keypair whose public half
 * Nebius stores). The SDK's `ServiceAccountBearer` signs a JWT with the private
 * key and exchanges it for a short-lived IAM access token over native gRPC.
 *
 * Inputs (a Nebius "authorized key", e.g. from `nebius iam auth-public-key`):
 *   serviceAccountId  the service account the key belongs to (`serviceaccount-…`)
 *   publicKeyId       the id of the registered public key (the JWT `kid`)
 *   privateKeyPem     the PEM-encoded private key (kept secret; masked)
 */

import { SDK } from '@nebius/js-sdk';
import { ServiceAccountBearer } from '@nebius/js-sdk/runtime/token/service_account';
import { ServiceAccount } from '@nebius/js-sdk/runtime/service_account/service_account';
import { mask } from '../io/log';
import type { IamToken } from './exchange';

export interface KeyExchangeParams {
  /** The service account the key authenticates as (`serviceaccount-…`). */
  serviceAccountId: string;
  /** The registered public key id (used as the signed JWT `kid`). */
  publicKeyId: string;
  /** The PEM-encoded private key half of the authorized key. */
  privateKeyPem: string;
  /** Optional SDK domain override (default: `api.nebius.cloud:443`). */
  domain?: string;
  /** Optional exchange-call timeout in milliseconds. */
  timeoutMs?: number;
}

/** Default IAM token lifetime (~12h) used when the response omits an expiry. */
const DEFAULT_LIFETIME_SECONDS = 12 * 60 * 60;

/**
 * Mint a Nebius IAM access token from a service-account authorized key using the
 * SDK's `ServiceAccountBearer`. Masks the returned token immediately.
 *
 * @throws on missing inputs or any SDK/gRPC error (no silent fallback).
 */
export async function exchangeKeyForIamToken(p: KeyExchangeParams): Promise<IamToken> {
  if (!p.serviceAccountId) {
    throw new Error('exchangeKeyForIamToken: serviceAccountId is required.');
  }
  if (!p.publicKeyId) {
    throw new Error('exchangeKeyForIamToken: publicKeyId is required.');
  }
  if (!p.privateKeyPem) {
    throw new Error('exchangeKeyForIamToken: privateKeyPem is required.');
  }

  const sdk = new SDK({
    ...(p.domain ? { domain: p.domain } : {}),
    logger: 'warn', // suppress the SDK's INFO chatter in CI logs
  });

  try {
    const serviceAccount = new ServiceAccount(p.privateKeyPem, p.publicKeyId, p.serviceAccountId);
    const bearer = new ServiceAccountBearer(serviceAccount, { sdk });

    const token = await bearer.receiver().fetch(p.timeoutMs);
    if (!token?.token) {
      throw new Error('Service-account key auth returned an empty access token.');
    }
    mask(token.token);

    const expiresInSeconds = token.expiration
      ? Math.max(0, Math.floor((token.expiration.getTime() - Date.now()) / 1000))
      : DEFAULT_LIFETIME_SECONDS;

    return { accessToken: token.token, expiresInSeconds };
  } finally {
    await sdk.close();
  }
}
