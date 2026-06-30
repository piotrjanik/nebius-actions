import { describe, it, expect, vi, beforeEach } from 'vitest';

const mintEphemeralKey = vi.fn();
const readAccessKeySecret = vi.fn();
const listObjects = vi.fn();
vi.mock('../../src/core/storage/keys', () => ({
  mintEphemeralKey: (...a: unknown[]) => mintEphemeralKey(...a),
  readAccessKeySecret: (...a: unknown[]) => readAccessKeySecret(...a),
}));
vi.mock('../../src/core/storage/s3', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/storage/s3')>('../../src/core/storage/s3');
  return { ...actual, listObjects: (...a: unknown[]) => listObjects(...a) };
});

import { checkObject } from '../../src/core/storage/check';

beforeEach(() => {
  mintEphemeralKey.mockReset();
  readAccessKeySecret.mockReset();
  listObjects.mockReset();
});

describe('checkObject', () => {
  it('mints a key and returns the object count under the prefix', async () => {
    mintEphemeralKey.mockResolvedValueOnce({ accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx' });
    readAccessKeySecret.mockResolvedValueOnce('SK');
    listObjects.mockResolvedValueOnce(['output/adapter_config.json', 'output/adapter_model.safetensors']);

    const n = await checkObject({
      bucket: 'b', prefix: 'output/', serviceAccountId: 'sa', projectId: 'p',
      endpoint: 'https://s3.example', region: 'eu-north1',
    });

    expect(n).toBe(2);
    expect(readAccessKeySecret).toHaveBeenCalledWith('ak');
    expect(listObjects).toHaveBeenCalledWith(
      { endpoint: 'https://s3.example', region: 'eu-north1', bucket: 'b' },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      'output/',
    );
  });

  it('returns 0 when nothing is under the prefix', async () => {
    mintEphemeralKey.mockResolvedValueOnce({ accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx' });
    readAccessKeySecret.mockResolvedValueOnce('SK');
    listObjects.mockResolvedValueOnce([]);
    expect(await checkObject({ bucket: 'b', prefix: 'output/', serviceAccountId: 'sa', projectId: 'p', endpoint: 'e', region: 'r' })).toBe(0);
  });
});
