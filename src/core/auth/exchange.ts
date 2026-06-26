/**
 * RFC-8693 OAuth 2.0 token exchange: GitHub OIDC JWT -> Nebius IAM access token.
 *
 * Pure HTTP via `@actions/http-client` (no CLI, no SDK). Tolerant of both
 * snake_case and camelCase response shapes (`access_token`/`accessToken`,
 * `expires_in`/`expiresIn`).
 */

import { HttpClient } from '@actions/http-client';
import { mask } from '../io/log';
import { TOKEN_EXCHANGE_GRANT_TYPE, REQUESTED_TOKEN_TYPE, SUBJECT_TOKEN_TYPE } from '../constants';

export interface ExchangeParams {
  idToken: string;
  endpoint: string;
  audience?: string;
  /** RFC-8693 subject_token_type; defaults to SUBJECT_TOKEN_TYPE (`id_token`). */
  subjectTokenType?: string;
}

export interface IamToken {
  accessToken: string;
  expiresInSeconds: number;
}

/** The subset of the token-exchange JSON response we read (both casings). */
interface TokenExchangeResponse {
  access_token?: string;
  accessToken?: string;
  expires_in?: number | string;
  expiresIn?: number | string;
}

/** Build the form-encoded RFC-8693 request body. Pure — unit-testable. */
export function buildExchangeBody(p: ExchangeParams): string {
  const params = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    requested_token_type: REQUESTED_TOKEN_TYPE,
    subject_token: p.idToken,
    subject_token_type: p.subjectTokenType ?? SUBJECT_TOKEN_TYPE,
  });
  if (p.audience !== undefined && p.audience !== '') {
    params.set('audience', p.audience);
  }
  return params.toString();
}

/** Coerce an `expires_in` value (number or numeric string) into seconds. */
function parseExpiresIn(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  // Default to a conservative Nebius IAM token lifetime (~12h) when absent.
  return 12 * 60 * 60;
}

/**
 * Exchange a GitHub OIDC JWT for a Nebius IAM access token.
 * Masks the returned token immediately.
 *
 * @throws on non-2xx HTTP, unparseable JSON, or a missing access token.
 */
export async function exchangeForIamToken(p: ExchangeParams): Promise<IamToken> {
  if (!p.idToken) {
    throw new Error('exchangeForIamToken: idToken is required.');
  }
  if (!p.endpoint) {
    throw new Error('exchangeForIamToken: endpoint is required.');
  }

  const client = new HttpClient('nebius-actions');
  const body = buildExchangeBody(p);
  const res = await client.post(p.endpoint, body, {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  });

  const status = res.message.statusCode ?? 0;
  const text = await res.readBody();
  if (status < 200 || status >= 300) {
    throw new Error(
      `Token exchange failed (HTTP ${status}) at ${p.endpoint}: ${text || '<empty body>'}`,
    );
  }

  let parsed: TokenExchangeResponse;
  try {
    parsed = JSON.parse(text) as TokenExchangeResponse;
  } catch {
    throw new Error(`Token exchange returned non-JSON body: ${text}`);
  }

  const accessToken = parsed.access_token ?? parsed.accessToken;
  if (!accessToken) {
    throw new Error(
      `Token exchange response missing access_token. Body: ${text || '<empty body>'}`,
    );
  }
  mask(accessToken);

  return {
    accessToken,
    expiresInSeconds: parseExpiresIn(parsed.expires_in ?? parsed.expiresIn),
  };
}
