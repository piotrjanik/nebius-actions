/**
 * Unit tests for service-account key auth (auth/key.ts).
 *
 * No network: `@nebius/js-sdk` (the SDK class + service-account classes) is
 * mocked. `@actions/core` is mocked so we can assert the IAM token is masked
 * via core.setSecret.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock the SDK surface ------------------------------------------------------
const fetchMock = vi.fn();
const closeMock = vi.fn();
const bearerCtor = vi.fn();
const serviceAccountCtor = vi.fn();
const sdkCtor = vi.fn();

vi.mock('@nebius/js-sdk', () => ({
  SDK: class {
    constructor(opts: unknown) {
      sdkCtor(opts);
    }
    close = closeMock;
  },
}));

vi.mock('@nebius/js-sdk/runtime/token/service_account', () => ({
  ServiceAccountBearer: class {
    constructor(sa: unknown, opts: unknown) {
      bearerCtor(sa, opts);
    }
    receiver() {
      return { fetch: fetchMock };
    }
  },
}));

vi.mock('@nebius/js-sdk/runtime/service_account/service_account', () => ({
  ServiceAccount: class {
    constructor(privateKeyPem: string, publicKeyId: string, serviceAccountId: string) {
      serviceAccountCtor(privateKeyPem, publicKeyId, serviceAccountId);
    }
  },
}));

// --- Mock @actions/core (mask() calls core.setSecret) --------------------------
const setSecret = vi.fn();
vi.mock('@actions/core', () => ({
  setSecret: (s: string) => setSecret(s),
}));

import { exchangeKeyForIamToken } from '../../src/core/auth/key';

beforeEach(() => {
  fetchMock.mockReset();
  closeMock.mockReset();
  bearerCtor.mockReset();
  serviceAccountCtor.mockReset();
  sdkCtor.mockReset();
  setSecret.mockReset();
});

const base = {
  serviceAccountId: 'serviceaccount-xyz',
  publicKeyId: 'publickey-abc',
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----',
};

describe('exchangeKeyForIamToken', () => {
  it('builds the ServiceAccount from key + id and passes the SDK to the bearer', async () => {
    fetchMock.mockResolvedValue({ token: 'IAM', expiration: undefined });

    await exchangeKeyForIamToken(base);

    expect(serviceAccountCtor).toHaveBeenCalledWith(
      base.privateKeyPem,
      base.publicKeyId,
      base.serviceAccountId,
    );
    const [, opts] = bearerCtor.mock.calls[0]!;
    expect(opts).toMatchObject({ sdk: expect.anything() });
  });

  it('returns the access token and masks it', async () => {
    fetchMock.mockResolvedValue({ token: 'TOP_SECRET', expiration: undefined });

    const tok = await exchangeKeyForIamToken(base);

    expect(tok.accessToken).toBe('TOP_SECRET');
    expect(setSecret).toHaveBeenCalledWith('TOP_SECRET');
  });

  it('derives expiresInSeconds from the token expiration', async () => {
    fetchMock.mockResolvedValue({ token: 'IAM', expiration: new Date(Date.now() + 3600 * 1000) });

    const tok = await exchangeKeyForIamToken(base);

    expect(tok.expiresInSeconds).toBeGreaterThan(3590);
    expect(tok.expiresInSeconds).toBeLessThanOrEqual(3600);
  });

  it('defaults expires to ~12h when the token has no expiration', async () => {
    fetchMock.mockResolvedValue({ token: 'IAM', expiration: undefined });

    const tok = await exchangeKeyForIamToken(base);

    expect(tok.expiresInSeconds).toBe(12 * 60 * 60);
  });

  it('passes a domain override to the SDK when provided', async () => {
    fetchMock.mockResolvedValue({ token: 'IAM', expiration: undefined });

    await exchangeKeyForIamToken({ ...base, domain: 'api.eu.nebius.cloud:443' });

    expect(sdkCtor).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'api.eu.nebius.cloud:443' }),
    );
  });

  it('closes the SDK even when the exchange throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));

    await expect(exchangeKeyForIamToken(base)).rejects.toThrow('boom');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the response has an empty token', async () => {
    fetchMock.mockResolvedValue({ token: '', expiration: undefined });

    await expect(exchangeKeyForIamToken(base)).rejects.toThrow(/empty access token/);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('throws when serviceAccountId is empty (no SDK call)', async () => {
    await expect(exchangeKeyForIamToken({ ...base, serviceAccountId: '' })).rejects.toThrow(
      /serviceAccountId/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when publicKeyId is empty (no SDK call)', async () => {
    await expect(exchangeKeyForIamToken({ ...base, publicKeyId: '' })).rejects.toThrow(
      /publicKeyId/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when privateKeyPem is empty (no SDK call)', async () => {
    await expect(exchangeKeyForIamToken({ ...base, privateKeyPem: '' })).rejects.toThrow(
      /privateKeyPem/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
