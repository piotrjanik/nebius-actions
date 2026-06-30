import { vi } from 'vitest';

const send = vi.fn();
const destroy = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = send;
    destroy = destroy;
    constructor(public config: unknown) {}
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class ListObjectsV2Command {
    constructor(public input: { Bucket: string; Prefix?: string; ContinuationToken?: string }) {}
  }
  class DeleteObjectsCommand {
    constructor(public input: { Bucket: string; Delete: { Objects: { Key: string }[] } }) {}
  }
  return { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand };
});

import { describe, it, expect } from 'vitest';
import { S3_ENDPOINT_DEFAULT, S3_REGION_DEFAULT } from '../../src/core/constants';
import { objectUri, buildS3ClientConfig } from '../../src/core/storage/s3';

describe('storage constants', () => {
  it('exposes Nebius S3 defaults', () => {
    expect(S3_ENDPOINT_DEFAULT).toMatch(/^https:\/\//);
    expect(S3_REGION_DEFAULT).not.toBe('');
  });
});

describe('objectUri', () => {
  it('joins bucket and key, trimming a leading slash on the key', () => {
    expect(objectUri('my-bucket', 'cfg/config.yaml')).toBe('s3://my-bucket/cfg/config.yaml');
    expect(objectUri('my-bucket', '/cfg/config.yaml')).toBe('s3://my-bucket/cfg/config.yaml');
  });
});

describe('buildS3ClientConfig', () => {
  it('sets endpoint, region, path-style and static creds', () => {
    const cfg = buildS3ClientConfig(
      { endpoint: 'https://storage.example', region: 'eu-north1' },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
    );
    expect(cfg.endpoint).toBe('https://storage.example');
    expect(cfg.region).toBe('eu-north1');
    expect(cfg.forcePathStyle).toBe(true);
    expect(cfg.credentials).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' });
  });
});

import { listObjects, deleteObjects } from '../../src/core/storage/s3';

const LOC = { endpoint: 'https://s3.example', region: 'eu-north1', bucket: 'b' };
const CREDS = { accessKeyId: 'AK', secretAccessKey: 'SK' };

describe('listObjects', () => {
  beforeEach(() => { send.mockReset(); destroy.mockReset(); });

  it('collects keys across paginated pages, threading the continuation token', async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'output/a' }, { Key: 'output/b' }], IsTruncated: true, NextContinuationToken: 't1' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'output/c' }], IsTruncated: false });
    const keys = await listObjects(LOC, CREDS, 'output/');
    expect(keys).toEqual(['output/a', 'output/b', 'output/c']);
    expect(send.mock.calls[0][0].input.ContinuationToken).toBeUndefined();
    expect(send.mock.calls[1][0].input.ContinuationToken).toBe('t1');
    expect(destroy).toHaveBeenCalled();
  });

  it('returns an empty array when the bucket has no matching objects', async () => {
    send.mockResolvedValueOnce({ Contents: undefined, IsTruncated: false });
    expect(await listObjects(LOC, CREDS, '')).toEqual([]);
  });
});

describe('deleteObjects', () => {
  beforeEach(() => { send.mockReset(); destroy.mockReset(); });

  it('does nothing (no S3 call) for an empty key list', async () => {
    await deleteObjects(LOC, CREDS, []);
    expect(send).not.toHaveBeenCalled();
  });

  it('batches deletes into chunks of at most 1000', async () => {
    send.mockResolvedValue({});
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`);
    await deleteObjects(LOC, CREDS, keys);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0].input.Delete.Objects).toHaveLength(1000);
    expect(send.mock.calls[1][0].input.Delete.Objects).toHaveLength(1000);
    expect(send.mock.calls[2][0].input.Delete.Objects).toHaveLength(500);
    expect(send.mock.calls[0][0].input.Delete.Objects[0]).toEqual({ Key: 'k0' });
  });
});
