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
