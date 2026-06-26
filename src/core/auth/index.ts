/**
 * Auth orchestrator: GitHub OIDC -> Nebius IAM token (keyless).
 */

import { getGithubIdToken } from './oidc';
import { exchangeForIamToken } from './exchange';
import { DEFAULT_TOKEN_EXCHANGE_URL } from '../constants';

export { getGithubIdToken } from './oidc';
export {
  exchangeForIamToken,
  buildExchangeBody,
  type ExchangeParams,
  type IamToken,
} from './exchange';

export interface AuthOptions {
  /** Only `oidc` is implemented in v1 (extensible enum; spec §10). */
  method: 'oidc';
  audience?: string;
  endpoint: string;
  /** RFC-8693 subject_token_type override; defaults to SUBJECT_TOKEN_TYPE. */
  subjectTokenType?: string;
}

export interface AuthResult {
  token: string;
  expiresInSeconds: number;
}

/**
 * Run the full keyless auth flow:
 *   1. fetch the GitHub OIDC JWT (masked),
 *   2. RFC-8693 exchange it for a Nebius IAM access token (masked).
 *
 * @throws on unsupported method or any step failure (no silent fallback).
 */
export async function authenticate(o: AuthOptions): Promise<AuthResult> {
  if (o.method !== 'oidc') {
    throw new Error(`Unsupported auth method '${o.method}'. Only 'oidc' is supported in v1.`);
  }
  const endpoint = o.endpoint || DEFAULT_TOKEN_EXCHANGE_URL;
  const idToken = await getGithubIdToken(o.audience);
  const iam = await exchangeForIamToken({
    idToken,
    endpoint,
    ...(o.audience !== undefined ? { audience: o.audience } : {}),
    ...(o.subjectTokenType !== undefined ? { subjectTokenType: o.subjectTokenType } : {}),
  });
  return { token: iam.accessToken, expiresInSeconds: iam.expiresInSeconds };
}
