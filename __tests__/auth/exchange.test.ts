/**
 * Unit tests for the SDK-based token exchange (auth/exchange.ts).
 *
 * No network: `@nebius/js-sdk` (the SDK class + federated-credentials classes)
 * is mocked. `@actions/core` is mocked so we can assert the IAM token is masked
 * via core.setSecret.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock the SDK surface ------------------------------------------------------
// A shared `fetchMock` lets each test stage the token the receiver returns and
// inspect how the bearer was constructed.
const fetchMock = vi.fn();
const closeMock = vi.fn();
const bearerCtor = vi.fn();
const staticCredsCtor = vi.fn();
const sdkCtor = vi.fn();

vi.mock('@nebius/js-sdk', () => ({
  SDK: class {
    constructor(opts: unknown) {
      sdkCtor(opts);
    }
    close = closeMock;
  },
}));

vi.mock('@nebius/js-sdk/runtime/token/federated_credentials', () => ({
  FederatedCredentialsBearer: class {
    constructor(creds: unknown, opts: unknown) {
      bearerCtor(creds, opts);
    }
    receiver() {
      return { fetch: fetchMock };
    }
  },
}));

vi.mock('@nebius/js-sdk/runtime/service_account/federated_credentials', () => ({
  StaticFederatedCredentials: class {
    constructor(jwt: string) {
      staticCredsCtor(jwt);
    }
  },
}));

// --- Mock @actions/core (mask() calls core.setSecret) --------------------------
const setSecret = vi.fn();
vi.mock('@actions/core', () => ({
  setSecret: (s: string) => setSecret(s),
}));

import { exchangeForIamToken } from '../../src/core/auth/exchange';

beforeEach(() => {
  fetchMock.mockReset();
  closeMock.mockReset();
  bearerCtor.mockReset();
  staticCredsCtor.mockReset();
  sdkCtor.mockReset();
  setSecret.mockReset();
});

const base = { idToken: 'GH_OIDC_JWT', serviceAccountId: 'serviceaccount-xyz' };

describe('exchangeForIamToken', () => {
  it('passes the JWT as actor and the SA id as subject to the SDK bearer', async () => {
    fetchMock.mockResolvedValue({ token: 'IAM', expiration: undefined });

    await exchangeForIamToken(base);

    expect(staticCredsCtor).toHaveBeenCalledWith('GH_OIDC_JWT');
    const [, opts] = bearerCtor.mock.calls[0]!;
    expect(opts).toMatchObject({ serviceAccountId: 'serviceaccount-xyz' });
  });

  it('returns the access token and masks it', async () => {
    fetchMock.mockResolvedValue({ token: 'TOP_SECRET', expiration: undefined });

    const tok = await exchangeForIamToken(base);

    expect(tok.accessToken).toBe('TOP_SECRET');
    expect(setSecret).toHaveBeenCalledWith('TOP_SECRET');
  });

  it('derives expiresInSeconds from the token expiration', async () => {
    fetchMock.mockResolvedValue({ token: 'IAM', expiration: new Date(Date.now() + 3600 * 1000) });

    const tok = await exchangeForIamToken(base);

    // ~3600s, allow a small clock delta from Date.now().
    expect(tok.expiresInSeconds).toBeGreaterThan(3590);
    expect(tok.expiresInSeconds).toBeLessThanOrEqual(3600);
  });

  it('defaults expires to ~12h when the token has no expiration', async () => {
    fetchMock.mockResolvedValue({ token: 'IAM', expiration: undefined });

    const tok = await exchangeForIamToken(base);

    expect(tok.expiresInSeconds).toBe(12 * 60 * 60);
  });

  it('passes a domain override to the SDK when provided', async () => {
    fetchMock.mockResolvedValue({ token: 'IAM', expiration: undefined });

    await exchangeForIamToken({ ...base, domain: 'api.eu.nebius.cloud:443' });

    expect(sdkCtor).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'api.eu.nebius.cloud:443' }),
    );
  });

  it('closes the SDK even when the exchange throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));

    await expect(exchangeForIamToken(base)).rejects.toThrow('boom');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the response has an empty token', async () => {
    fetchMock.mockResolvedValue({ token: '', expiration: undefined });

    await expect(exchangeForIamToken(base)).rejects.toThrow(/empty access token/);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('throws when idToken is empty (no SDK call)', async () => {
    await expect(exchangeForIamToken({ ...base, idToken: '' })).rejects.toThrow(/idToken/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when serviceAccountId is empty (no SDK call)', async () => {
    await expect(exchangeForIamToken({ ...base, serviceAccountId: '' })).rejects.toThrow(
      /serviceAccountId/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
