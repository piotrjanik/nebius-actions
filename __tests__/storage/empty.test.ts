import { describe, it, expect, vi, beforeEach } from 'vitest';

const mintEphemeralKey = vi.fn();
const readAccessKeySecret = vi.fn();
const listObjects = vi.fn();
const deleteObjects = vi.fn();
vi.mock('../../src/core/storage/keys', () => ({
  mintEphemeralKey: (...a: unknown[]) => mintEphemeralKey(...a),
  readAccessKeySecret: (...a: unknown[]) => readAccessKeySecret(...a),
}));
vi.mock('../../src/core/storage/s3', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/storage/s3')>('../../src/core/storage/s3');
  return { ...actual, listObjects: (...a: unknown[]) => listObjects(...a), deleteObjects: (...a: unknown[]) => deleteObjects(...a) };
});

import { emptyBucket } from '../../src/core/storage/empty';

beforeEach(() => {
  mintEphemeralKey.mockReset();
  readAccessKeySecret.mockReset();
  listObjects.mockReset();
  deleteObjects.mockReset();
});

describe('emptyBucket', () => {
  it('lists then deletes every object and returns the count', async () => {
    mintEphemeralKey.mockResolvedValueOnce({ accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx' });
    readAccessKeySecret.mockResolvedValueOnce('SK');
    listObjects.mockResolvedValueOnce(['config.yaml', 'output/adapter_config.json']);
    deleteObjects.mockResolvedValueOnce(undefined);

    const n = await emptyBucket({ bucket: 'b', serviceAccountId: 'sa', projectId: 'p', endpoint: 'https://s3.example', region: 'eu-north1' });

    expect(n).toBe(2);
    const loc = { endpoint: 'https://s3.example', region: 'eu-north1', bucket: 'b' };
    const creds = { accessKeyId: 'AK', secretAccessKey: 'SK' };
    expect(listObjects).toHaveBeenCalledWith(loc, creds, '');
    expect(deleteObjects).toHaveBeenCalledWith(loc, creds, ['config.yaml', 'output/adapter_config.json']);
  });

  it('returns 0 and still calls deleteObjects (no-op) for an empty bucket', async () => {
    mintEphemeralKey.mockResolvedValueOnce({ accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx' });
    readAccessKeySecret.mockResolvedValueOnce('SK');
    listObjects.mockResolvedValueOnce([]);
    deleteObjects.mockResolvedValueOnce(undefined);
    expect(await emptyBucket({ bucket: 'b', serviceAccountId: 'sa', projectId: 'p', endpoint: 'e', region: 'r' })).toBe(0);
  });
});
