/**
 * Unit tests for the RFC-8693 token-exchange (auth/exchange.ts).
 *
 * No network: `@actions/http-client` is fully mocked. `@actions/core` is mocked
 * so we can assert the IAM token is masked via core.setSecret.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock @actions/http-client -------------------------------------------------
// A single shared `post` spy lets each test stage the response and inspect args.
const postMock = vi.fn();
vi.mock('@actions/http-client', () => ({
  HttpClient: class {
    // mirror the real surface used by exchange.ts
    post = postMock;
  },
}));

// --- Mock @actions/core (mask() calls core.setSecret) --------------------------
const setSecret = vi.fn();
vi.mock('@actions/core', () => ({
  setSecret: (s: string) => setSecret(s),
}));

import {
  buildExchangeBody,
  exchangeForIamToken,
  type ExchangeParams,
} from '../../src/core/auth/exchange';
import {
  TOKEN_EXCHANGE_GRANT_TYPE,
  REQUESTED_TOKEN_TYPE,
  SUBJECT_TOKEN_TYPE,
} from '../../src/core/constants';

/** Build a fake HttpClientResponse with the given status + JSON/text body. */
function fakeResponse(statusCode: number, body: string) {
  return {
    message: { statusCode },
    readBody: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  postMock.mockReset();
  setSecret.mockReset();
});

describe('buildExchangeBody', () => {
  it('emits the RFC-8693 grant_type / requested_token_type / subject_token_type', () => {
    const params = new URLSearchParams(
      buildExchangeBody({ idToken: 'JWT', endpoint: 'https://x' }),
    );
    expect(params.get('grant_type')).toBe(TOKEN_EXCHANGE_GRANT_TYPE);
    expect(params.get('requested_token_type')).toBe(REQUESTED_TOKEN_TYPE);
    expect(params.get('subject_token_type')).toBe(SUBJECT_TOKEN_TYPE);
    expect(params.get('subject_token')).toBe('JWT');
  });

  it('includes audience when provided', () => {
    const params = new URLSearchParams(
      buildExchangeBody({ idToken: 'JWT', endpoint: 'https://x', audience: 'nebius' }),
    );
    expect(params.get('audience')).toBe('nebius');
  });

  it('omits audience when undefined', () => {
    const body = buildExchangeBody({ idToken: 'JWT', endpoint: 'https://x' });
    expect(body).not.toContain('audience');
  });

  it('omits audience when empty string', () => {
    const body = buildExchangeBody({ idToken: 'JWT', endpoint: 'https://x', audience: '' });
    expect(body).not.toContain('audience');
  });

  it('url-encodes the subject token', () => {
    const body = buildExchangeBody({ idToken: 'a b+c', endpoint: 'https://x' });
    // URLSearchParams encodes space as + and + as %2B
    expect(body).toContain('subject_token=a+b%2Bc');
  });
});

describe('exchangeForIamToken', () => {
  const base: ExchangeParams = {
    idToken: 'GH_OIDC_JWT',
    endpoint: 'https://auth.eu.nebius.com/oauth2/token/exchange',
  };

  it('POSTs the form-encoded RFC-8693 body to the endpoint with correct headers', async () => {
    postMock.mockResolvedValue(
      fakeResponse(200, JSON.stringify({ access_token: 'IAM', expires_in: 3600 })),
    );

    await exchangeForIamToken({ ...base, audience: 'aud-1' });

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body, headers] = postMock.mock.calls[0]!;
    expect(url).toBe(base.endpoint);

    const params = new URLSearchParams(body as string);
    expect(params.get('grant_type')).toBe(TOKEN_EXCHANGE_GRANT_TYPE);
    expect(params.get('requested_token_type')).toBe(REQUESTED_TOKEN_TYPE);
    expect(params.get('subject_token')).toBe('GH_OIDC_JWT');
    expect(params.get('subject_token_type')).toBe(SUBJECT_TOKEN_TYPE);
    expect(params.get('audience')).toBe('aud-1');

    expect(headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    });
  });

  it('parses snake_case access_token + expires_in', async () => {
    postMock.mockResolvedValue(
      fakeResponse(200, JSON.stringify({ access_token: 'IAM_SNAKE', expires_in: 4321 })),
    );
    const tok = await exchangeForIamToken(base);
    expect(tok.accessToken).toBe('IAM_SNAKE');
    expect(tok.expiresInSeconds).toBe(4321);
  });

  it('parses camelCase accessToken + expiresIn', async () => {
    postMock.mockResolvedValue(
      fakeResponse(200, JSON.stringify({ accessToken: 'IAM_CAMEL', expiresIn: 7200 })),
    );
    const tok = await exchangeForIamToken(base);
    expect(tok.accessToken).toBe('IAM_CAMEL');
    expect(tok.expiresInSeconds).toBe(7200);
  });

  it('coerces a numeric-string expires_in', async () => {
    postMock.mockResolvedValue(
      fakeResponse(200, JSON.stringify({ access_token: 'IAM', expires_in: '900' })),
    );
    const tok = await exchangeForIamToken(base);
    expect(tok.expiresInSeconds).toBe(900);
  });

  it('defaults expires to ~12h when absent', async () => {
    postMock.mockResolvedValue(fakeResponse(200, JSON.stringify({ access_token: 'IAM' })));
    const tok = await exchangeForIamToken(base);
    expect(tok.expiresInSeconds).toBe(12 * 60 * 60);
  });

  it('masks the returned IAM token via core.setSecret', async () => {
    postMock.mockResolvedValue(
      fakeResponse(200, JSON.stringify({ access_token: 'TOP_SECRET', expires_in: 1 })),
    );
    await exchangeForIamToken(base);
    expect(setSecret).toHaveBeenCalledWith('TOP_SECRET');
  });

  it('throws (with status + body) on a non-2xx response', async () => {
    postMock.mockResolvedValue(fakeResponse(403, 'forbidden'));
    await expect(exchangeForIamToken(base)).rejects.toThrow(/HTTP 403/);
    await expect(exchangeForIamToken(base)).rejects.toThrow(/forbidden/);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('throws on a non-JSON 2xx body', async () => {
    postMock.mockResolvedValue(fakeResponse(200, 'not-json'));
    await expect(exchangeForIamToken(base)).rejects.toThrow(/non-JSON/);
  });

  it('throws when access_token is missing from a 2xx body', async () => {
    postMock.mockResolvedValue(fakeResponse(200, JSON.stringify({ expires_in: 10 })));
    await expect(exchangeForIamToken(base)).rejects.toThrow(/missing access_token/);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('throws when idToken is empty (no network call)', async () => {
    await expect(exchangeForIamToken({ ...base, idToken: '' })).rejects.toThrow(/idToken/);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('throws when endpoint is empty (no network call)', async () => {
    await expect(exchangeForIamToken({ ...base, endpoint: '' })).rejects.toThrow(/endpoint/);
    expect(postMock).not.toHaveBeenCalled();
  });
});
