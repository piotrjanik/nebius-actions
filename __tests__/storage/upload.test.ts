import { describe, it, expect, vi, beforeEach } from 'vitest';

const mintEphemeralKey = vi.fn();
const readAccessKeySecret = vi.fn();
const putObject = vi.fn();
vi.mock('../../src/core/storage/keys', () => ({
  mintEphemeralKey: (...a: unknown[]) => mintEphemeralKey(...a),
  readAccessKeySecret: (...a: unknown[]) => readAccessKeySecret(...a),
}));
vi.mock('../../src/core/storage/s3', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/storage/s3')>(
    '../../src/core/storage/s3',
  );
  return { ...actual, putObject: (...a: unknown[]) => putObject(...a) };
});
vi.mock('node:fs', () => ({ readFileSync: () => Buffer.from('config: yaml\n') }));

import { uploadObject } from '../../src/core/storage/upload';

beforeEach(() => {
  mintEphemeralKey.mockReset();
  readAccessKeySecret.mockReset();
  putObject.mockReset();
});

describe('uploadObject', () => {
  it('mints a key, uploads, and returns uri + secret id', async () => {
    mintEphemeralKey.mockResolvedValueOnce({ accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx-1' });
    readAccessKeySecret.mockResolvedValueOnce('SK');
    putObject.mockResolvedValueOnce(undefined);

    const res = await uploadObject({
      source: '/tmp/config.yaml', bucket: 'b', key: 'cfg/config.yaml',
      serviceAccountId: 'sa', projectId: 'proj',
      endpoint: 'https://s3.example', region: 'eu-north1',
    });

    expect(res).toEqual({ objectUri: 's3://b/cfg/config.yaml', secretId: 'mbx-1' });
    expect(putObject).toHaveBeenCalledWith(
      { endpoint: 'https://s3.example', region: 'eu-north1', bucket: 'b', key: 'cfg/config.yaml' },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      expect.anything(),
    );
  });
});
