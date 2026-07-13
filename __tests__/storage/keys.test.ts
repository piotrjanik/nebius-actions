/**
 * Unit tests for the ephemeral access-key domain (storage/keys.ts).
 *
 * The SDK `AccessKeyService` / MysteryBox `PayloadService` are replaced with
 * tiny fakes (no network, no SDK construction). We assert the pure request
 * builder, the mint flow (create -> wait -> get), and the payload read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecretDeliveryMode } from '@nebius/js-sdk/api/nebius/iam/v2/index';

vi.mock('../../src/core/io/log', () => ({ mask: vi.fn(), log: { info: vi.fn() } }));

import { mask } from '../../src/core/io/log';
import {
  buildCreateAccessKeyRequest,
  ephemeralKeyName,
  mintEphemeralKey,
  mintS3Credentials,
  readAccessKeySecret,
  type AccessKeyServiceLike,
  type PayloadServiceLike,
} from '../../src/core/storage/keys';

beforeEach(() => {
  vi.mocked(mask).mockReset();
});

const keyOp = (id: string) => ({ resourceId: () => id, wait: vi.fn(async () => {}) });

function fakeAccessKeys(opts: {
  id?: string;
  status?: { awsAccessKeyId?: string; secretReferenceId?: string };
}): AccessKeyServiceLike & { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  const create = vi.fn(() => ({ result: Promise.resolve(keyOp(opts.id ?? 'ak-1')) }));
  const get = vi.fn(() => Promise.resolve({ status: opts.status }));
  return { create, get } as unknown as AccessKeyServiceLike & {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
}

function fakePayloads(data: unknown): PayloadServiceLike & { get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(() => Promise.resolve({ data }));
  return { get } as unknown as PayloadServiceLike & { get: ReturnType<typeof vi.fn> };
}

describe('buildCreateAccessKeyRequest', () => {
  it('builds the request with parent, SA account, and MysteryBox delivery', () => {
    const req = buildCreateAccessKeyRequest({
      projectId: 'proj-1',
      serviceAccountId: 'sa-1',
      name: 'k',
      expiresAt: '2026-06-30T00:00:00Z',
    });
    expect(req.metadata?.parentId).toBe('proj-1');
    expect(req.metadata?.name).toBe('k');
    expect(req.spec?.secretDeliveryMode).toBe(SecretDeliveryMode.MYSTERY_BOX);
    expect(req.spec?.account?.type).toEqual({
      $case: 'serviceAccount',
      serviceAccount: expect.objectContaining({ id: 'sa-1' }),
    });
    expect(req.spec?.expiresAt?.toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });

  it('omits the name and expiry when absent', () => {
    const req = buildCreateAccessKeyRequest({ projectId: 'p', serviceAccountId: 's' });
    expect(req.metadata?.name).toBe('');
    expect(req.spec?.expiresAt).toBeUndefined();
  });

  it('throws when projectId is missing', () => {
    expect(() => buildCreateAccessKeyRequest({ projectId: '', serviceAccountId: 's' })).toThrow(
      /projectId/,
    );
  });

  it('throws when serviceAccountId is missing', () => {
    expect(() => buildCreateAccessKeyRequest({ projectId: 'p', serviceAccountId: '' })).toThrow(
      /serviceAccountId/,
    );
  });
});

describe('ephemeralKeyName', () => {
  it('starts with the verb and bucket', () => {
    expect(ephemeralKeyName('upload', 'demo-axolotl-1')).toMatch(/^upload-demo-axolotl-1-/);
  });

  it('is unique per invocation for the same verb and bucket', () => {
    // IAM rejects duplicate names (AlreadyExists), so two steps hitting the
    // same bucket within the key TTL must not produce the same name.
    const a = ephemeralKeyName('upload', 'demo-axolotl-1');
    const b = ephemeralKeyName('upload', 'demo-axolotl-1');
    expect(a).not.toBe(b);
  });

  it('caps the name at 63 chars even for long bucket names', () => {
    const name = ephemeralKeyName('download', 'b'.repeat(63));
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^download-b/);
  });
});

describe('mintEphemeralKey', () => {
  it('creates the key, waits for the operation, and reads ids from the get', async () => {
    const service = fakeAccessKeys({
      id: 'ak-123',
      status: { awsAccessKeyId: 'AKIA...', secretReferenceId: 'mbsec-9' },
    });
    const m = await mintEphemeralKey(service, { projectId: 'p', serviceAccountId: 's' });
    expect(m).toEqual({ accessKeyId: 'ak-123', awsAccessKeyId: 'AKIA...', secretId: 'mbsec-9' });
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.get).toHaveBeenCalledTimes(1);
  });

  it('throws when the aws access key id is missing on the created key', async () => {
    const service = fakeAccessKeys({ status: { secretReferenceId: 'mbsec-9' } });
    await expect(mintEphemeralKey(service, { projectId: 'p', serviceAccountId: 's' })).rejects.toThrow(
      /aws access key/i,
    );
  });

  it('throws when the MysteryBox secret id is missing on the created key', async () => {
    const service = fakeAccessKeys({ status: { awsAccessKeyId: 'AKIA...' } });
    await expect(mintEphemeralKey(service, { projectId: 'p', serviceAccountId: 's' })).rejects.toThrow(
      /MysteryBox secret id/i,
    );
  });
});

describe('readAccessKeySecret', () => {
  it('reads and masks the plaintext from the MysteryBox payload', async () => {
    const payloads = fakePayloads([
      { key: 'secret', payload: { $case: 'stringValue', stringValue: 'SECRET-XYZ' } },
    ]);
    const s = await readAccessKeySecret(payloads, 'mbsec-9');
    expect(s).toBe('SECRET-XYZ');
    expect(payloads.get).toHaveBeenCalledTimes(1);
    expect(mask).toHaveBeenCalledWith('SECRET-XYZ');
  });

  it('throws when the secret reference id is missing', async () => {
    await expect(readAccessKeySecret(fakePayloads([]), '')).rejects.toThrow(/secretReferenceId/);
  });

  it('throws when the payload has no secret entry', async () => {
    const payloads = fakePayloads([
      { key: 'other', payload: { $case: 'stringValue', stringValue: 'x' } },
    ]);
    await expect(readAccessKeySecret(payloads, 'mbsec-9')).rejects.toThrow(
      /not found in MysteryBox payload/,
    );
  });
});

describe('mintS3Credentials', () => {
  it('chains mint -> secret read into S3-ready credentials', async () => {
    const accessKeys = fakeAccessKeys({
      id: 'ak-1',
      status: { awsAccessKeyId: 'AK', secretReferenceId: 'mbx-1' },
    });
    const payloads = fakePayloads([
      { key: 'secret', payload: { $case: 'stringValue', stringValue: 'SK' } },
    ]);
    const { minted, secretAccessKey } = await mintS3Credentials(
      { accessKeys, payloads },
      { projectId: 'p', serviceAccountId: 's' },
    );
    expect(minted).toEqual({ accessKeyId: 'ak-1', awsAccessKeyId: 'AK', secretId: 'mbx-1' });
    expect(secretAccessKey).toBe('SK');
  });
});
