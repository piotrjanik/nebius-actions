/**
 * Unit tests for the bucket control-plane domain (storage/bucket.ts).
 *
 * The SDK `BucketService` is replaced with a tiny fake (no network, no SDK
 * construction). We assert the pure request builders and the create/delete
 * flows against the fake.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildCreateBucketRequest,
  createBucket,
  buildDeleteBucketRequest,
  deleteBucket,
  type BucketServiceLike,
} from '../../src/core/storage/bucket';

const op = (id: string) => ({ resourceId: () => id, raw: () => ({ op: true }) });

describe('buildCreateBucketRequest', () => {
  it('maps name and projectId -> metadata', () => {
    const req = buildCreateBucketRequest({ name: 'demo-1', projectId: 'proj' });
    expect(req.metadata?.name).toBe('demo-1');
    expect(req.metadata?.parentId).toBe('proj');
    expect(req.spec).toBeUndefined();
  });

  it('sets spec.maxSizeBytes when given', () => {
    const req = buildCreateBucketRequest({ name: 'd', projectId: 'p', maxSizeBytes: '100' });
    expect(Number(req.spec?.maxSizeBytes)).toBe(100);
  });

  it('throws on a non-numeric maxSizeBytes', () => {
    expect(() =>
      buildCreateBucketRequest({ name: 'd', projectId: 'p', maxSizeBytes: '100Gi' }),
    ).toThrow(/byte count/);
  });

  it('throws when name or projectId is missing', () => {
    expect(() => buildCreateBucketRequest({ name: '', projectId: 'p' })).toThrow(/name/);
    expect(() => buildCreateBucketRequest({ name: 'd', projectId: '' })).toThrow(/projectId/);
  });
});

describe('createBucket', () => {
  it('returns the operation resource id and the requested name', async () => {
    const create = vi.fn(() => ({ result: Promise.resolve(op('bkt-1')) }));
    const service = { create, delete: vi.fn() } as unknown as BucketServiceLike;
    expect(await createBucket(service, { name: 'demo-1', projectId: 'p' })).toEqual({
      id: 'bkt-1',
      name: 'demo-1',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('throws when the operation carries no id', async () => {
    const service = {
      create: () => ({ result: Promise.resolve(op('')) }),
      delete: vi.fn(),
    } as unknown as BucketServiceLike;
    await expect(createBucket(service, { name: 'd', projectId: 'p' })).rejects.toThrow(
      /bucket id/i,
    );
  });
});

describe('delete', () => {
  it('builds the delete request with a zero purge ttl by default', () => {
    const req = buildDeleteBucketRequest('bkt-1');
    expect(req.id).toBe('bkt-1');
    expect(req.purge?.$case).toBe('ttl');
    expect(req.purge?.$case === 'ttl' && req.purge.ttl.asMilliseconds()).toBe(0);
  });

  it('parses a non-zero ttl duration', () => {
    const req = buildDeleteBucketRequest('bkt-1', '1h');
    expect(req.purge?.$case === 'ttl' && req.purge.ttl.asMilliseconds()).toBe(3_600_000);
  });

  it('throws on an unparseable ttl', () => {
    expect(() => buildDeleteBucketRequest('bkt-1', 'soon')).toThrow(/ttl/);
  });

  it('throws when id is missing', () => {
    expect(() => buildDeleteBucketRequest('')).toThrow(/id is required/);
  });

  it('awaits the delete operation against the service', async () => {
    const del = vi.fn(() => ({ result: Promise.resolve(op('bkt-1')) }));
    const service = { create: vi.fn(), delete: del } as unknown as BucketServiceLike;
    await deleteBucket(service, 'bkt-1');
    expect(del).toHaveBeenCalledTimes(1);
  });
});
