/**
 * RFC-8693 token exchange via the official Nebius JS SDK (`@nebius/js-sdk`).
 *
 * Uses the SDK's federated-credentials delegation flow over native gRPC
 * (`tokens.iam.api.nebius.cloud:443`), which is the only transport that accepts
 * the workload-identity request. The HTTP OAuth2 gateway rejects the
 * `subject_identifier` subject-token type, so we do NOT use it.
 *
 * The request the SDK builds (see `FederatedCredentialsTokenRequester`):
 *   grant_type           = urn:ietf:params:oauth:grant-type:token-exchange
 *   requested_token_type = urn:ietf:params:oauth:token-type:access_token
 *   subject_token        = <service-account id>            // who the token is FOR
 *   subject_token_type   = urn:nebius:params:oauth:token-type:subject_identifier
 *   actor_token          = <GitHub OIDC JWT>               // who is impersonating
 *   actor_token_type     = urn:ietf:params:oauth:token-type:jwt
 */

import { SDK } from '@nebius/js-sdk';
import { FederatedCredentialsBearer } from '@nebius/js-sdk/runtime/token/federated_credentials';
import { StaticFederatedCredentials } from '@nebius/js-sdk/runtime/service_account/federated_credentials';
import { mask } from '../io/log';

export interface ExchangeParams {
  /** The GitHub OIDC JWT — the actor token impersonating the service account. */
  idToken: string;
  /** The Nebius service account to impersonate — the subject (`serviceaccount-…`). */
  serviceAccountId: string;
  /** Optional SDK domain override (default: `api.nebius.cloud:443`). */
  domain?: string;
  /** Optional exchange-call timeout in milliseconds. */
  timeoutMs?: number;
}

export interface IamToken {
  accessToken: string;
  expiresInSeconds: number;
}

/** Default IAM token lifetime (~12h) used when the response omits an expiry. */
const DEFAULT_LIFETIME_SECONDS = 12 * 60 * 60;

/**
 * Exchange a GitHub OIDC JWT for a Nebius IAM access token using the SDK's
 * federated-credentials delegation flow. Masks the returned token immediately.
 *
 * @throws on missing inputs or any SDK/gRPC error (no silent fallback).
 */
export async function exchangeForIamToken(p: ExchangeParams): Promise<IamToken> {
  if (!p.idToken) {
    throw new Error('exchangeForIamToken: idToken is required.');
  }
  if (!p.serviceAccountId) {
    throw new Error('exchangeForIamToken: serviceAccountId is required.');
  }

  // No credentials are needed to construct the SDK: the exchange call runs with
  // authorization disabled (it is the bootstrap that mints the first token).
  const sdk = new SDK({
    ...(p.domain ? { domain: p.domain } : {}),
    logger: 'warn', // suppress the SDK's INFO chatter in CI logs
  });

  try {
    const bearer = new FederatedCredentialsBearer(new StaticFederatedCredentials(p.idToken), {
      sdk,
      serviceAccountId: p.serviceAccountId,
    });

    const token = await bearer.receiver().fetch(p.timeoutMs);
    if (!token?.token) {
      throw new Error('Token exchange returned an empty access token.');
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
