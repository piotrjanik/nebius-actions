import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mintEphemeralKey = vi.fn();
const readAccessKeySecret = vi.fn();
const listObjects = vi.fn();
const getObject = vi.fn();
vi.mock('../../src/core/storage/keys', () => ({
  mintEphemeralKey: (...a: unknown[]) => mintEphemeralKey(...a),
  readAccessKeySecret: (...a: unknown[]) => readAccessKeySecret(...a),
}));
vi.mock('../../src/core/storage/s3', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/storage/s3')>('../../src/core/storage/s3');
  return {
    ...actual,
    listObjects: (...a: unknown[]) => listObjects(...a),
    getObject: (...a: unknown[]) => getObject(...a),
  };
});

import { destPathForKey, downloadObjects } from '../../src/core/storage/download';

beforeEach(() => {
  mintEphemeralKey.mockReset();
  readAccessKeySecret.mockReset();
  listObjects.mockReset();
  getObject.mockReset();
});

describe('destPathForKey', () => {
  it('strips the prefix and joins under dest', () => {
    expect(destPathForKey('/tmp/out', 'output/', 'output/adapter_config.json')).toBe(
      join('/tmp/out', 'adapter_config.json'),
    );
  });

  it('preserves nested key paths relative to the prefix', () => {
    expect(destPathForKey('/tmp/out', 'output/', 'output/checkpoint-30/adapter_model.safetensors')).toBe(
      join('/tmp/out', 'checkpoint-30', 'adapter_model.safetensors'),
    );
  });

  it('falls back to the basename when the key equals the prefix (single object)', () => {
    expect(destPathForKey('/tmp/out', 'output/config.yaml', 'output/config.yaml')).toBe(
      join('/tmp/out', 'config.yaml'),
    );
  });

  it('refuses keys that would escape dest', () => {
    expect(() => destPathForKey('/tmp/out', 'output/', 'output/../../etc/passwd')).toThrow(/outside dest/);
  });
});

describe('downloadObjects', () => {
  const spec = (dest: string) => ({
    bucket: 'b', prefix: 'output/', dest,
    serviceAccountId: 'sa', projectId: 'p',
    endpoint: 'https://s3.example', region: 'eu-north1',
  });

  it('mints a key, lists the prefix, and writes each object under dest', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'dl-'));
    try {
      mintEphemeralKey.mockResolvedValueOnce({ accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx' });
      readAccessKeySecret.mockResolvedValueOnce('SK');
      listObjects.mockResolvedValueOnce(['output/adapter_config.json', 'output/checkpoint-30/x.bin']);
      getObject.mockResolvedValueOnce(Buffer.from('{"r":8}')).mockResolvedValueOnce(Buffer.from('bin'));

      const r = await downloadObjects(spec(dest));

      expect(r.dest).toBe(dest);
      expect(r.files).toEqual([join(dest, 'adapter_config.json'), join(dest, 'checkpoint-30', 'x.bin')]);
      expect(readFileSync(join(dest, 'adapter_config.json'), 'utf8')).toBe('{"r":8}');
      expect(readFileSync(join(dest, 'checkpoint-30', 'x.bin'), 'utf8')).toBe('bin');
      expect(readAccessKeySecret).toHaveBeenCalledWith('mbx');
      expect(getObject).toHaveBeenCalledWith(
        { endpoint: 'https://s3.example', region: 'eu-north1', bucket: 'b', key: 'output/adapter_config.json' },
        { accessKeyId: 'AK', secretAccessKey: 'SK' },
      );
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('throws when nothing exists under the prefix', async () => {
    mintEphemeralKey.mockResolvedValueOnce({ accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx' });
    readAccessKeySecret.mockResolvedValueOnce('SK');
    listObjects.mockResolvedValueOnce([]);
    await expect(downloadObjects(spec('/tmp/never-used'))).rejects.toThrow(/No objects under prefix/);
  });
});
