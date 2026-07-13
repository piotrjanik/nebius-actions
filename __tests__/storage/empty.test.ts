import { describe, it, expect, vi, beforeEach } from 'vitest';

const mintS3Credentials = vi.fn();
const listObjects = vi.fn();
const deleteObjects = vi.fn();
vi.mock('../../src/core/storage/keys', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/storage/keys')>(
    '../../src/core/storage/keys',
  );
  return {
    ...actual,
    mintS3Credentials: (...a: unknown[]) => mintS3Credentials(...a),
  };
});
vi.mock('../../src/core/storage/s3', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/storage/s3')>('../../src/core/storage/s3');
  return { ...actual, listObjects: (...a: unknown[]) => listObjects(...a), deleteObjects: (...a: unknown[]) => deleteObjects(...a) };
});

import { emptyBucket } from '../../src/core/storage/empty';
import type { KeyServices } from '../../src/core/storage/keys';

const services = { accessKeys: {}, payloads: {} } as unknown as KeyServices;

beforeEach(() => {
  mintS3Credentials.mockReset();
  listObjects.mockReset();
  deleteObjects.mockReset();
});

describe('emptyBucket', () => {
  it('lists then deletes every object and returns the count', async () => {
    mintS3Credentials.mockResolvedValueOnce({
      minted: { accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx' },
      secretAccessKey: 'SK',
    });
    listObjects.mockResolvedValueOnce(['config.yaml', 'output/adapter_config.json']);
    deleteObjects.mockResolvedValueOnce(undefined);

    const n = await emptyBucket(services, { bucket: 'b', serviceAccountId: 'sa', projectId: 'p', endpoint: 'https://s3.example', region: 'eu-north1' });

    expect(n).toBe(2);
    const loc = { endpoint: 'https://s3.example', region: 'eu-north1', bucket: 'b' };
    const creds = { accessKeyId: 'AK', secretAccessKey: 'SK' };
    expect(listObjects).toHaveBeenCalledWith(loc, creds, '');
    expect(deleteObjects).toHaveBeenCalledWith(loc, creds, ['config.yaml', 'output/adapter_config.json']);
  });

  it('returns 0 and still calls deleteObjects (no-op) for an empty bucket', async () => {
    mintS3Credentials.mockResolvedValueOnce({
      minted: { accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx' },
      secretAccessKey: 'SK',
    });
    listObjects.mockResolvedValueOnce([]);
    deleteObjects.mockResolvedValueOnce(undefined);
    expect(await emptyBucket(services, { bucket: 'b', serviceAccountId: 'sa', projectId: 'p', endpoint: 'e', region: 'r' })).toBe(0);
  });
});
