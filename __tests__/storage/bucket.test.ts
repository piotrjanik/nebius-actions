import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCli = vi.fn();
vi.mock('../../src/core/cli/exec', () => ({ runCli: (...a: unknown[]) => runCli(...a) }));

import {
  buildCreateBucketArgs,
  createBucket,
  buildDeleteBucketArgs,
  deleteBucket,
} from '../../src/core/storage/bucket';

beforeEach(() => runCli.mockReset());

describe('buildCreateBucketArgs', () => {
  it('builds the create command with name and parent', () => {
    expect(buildCreateBucketArgs({ name: 'demo-1', projectId: 'proj' })).toEqual([
      'storage', 'bucket', 'create', '--name', 'demo-1', '--parent-id', 'proj',
    ]);
  });
  it('appends max-size-bytes when set', () => {
    expect(buildCreateBucketArgs({ name: 'd', projectId: 'p', maxSizeBytes: '100' })).toEqual([
      'storage', 'bucket', 'create', '--name', 'd', '--parent-id', 'p', '--max-size-bytes', '100',
    ]);
  });
  it('throws when name or projectId is missing', () => {
    expect(() => buildCreateBucketArgs({ name: '', projectId: 'p' })).toThrow(/name/);
    expect(() => buildCreateBucketArgs({ name: 'd', projectId: '' })).toThrow(/projectId/);
  });
});

describe('createBucket', () => {
  it('returns id and name from the create JSON', async () => {
    runCli.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', data: { metadata: { id: 'bkt-1', name: 'demo-1' } } });
    expect(await createBucket({ name: 'demo-1', projectId: 'p' })).toEqual({ id: 'bkt-1', name: 'demo-1' });
  });
  it('falls back to the requested name when JSON omits it', async () => {
    runCli.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', data: { id: 'bkt-2' } });
    expect(await createBucket({ name: 'demo-2', projectId: 'p' })).toEqual({ id: 'bkt-2', name: 'demo-2' });
  });
  it('throws when no id is present', async () => {
    runCli.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', data: {} });
    await expect(createBucket({ name: 'd', projectId: 'p' })).rejects.toThrow(/bucket id/i);
  });
});

describe('delete', () => {
  it('builds the delete command with zero ttl by default', () => {
    expect(buildDeleteBucketArgs('bkt-1')).toEqual(['storage', 'bucket', 'delete', '--id', 'bkt-1', '--ttl', '0s']);
  });
  it('runs the delete CLI', async () => {
    runCli.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', data: {} });
    await deleteBucket('bkt-1');
    expect(runCli).toHaveBeenCalledWith(['storage', 'bucket', 'delete', '--id', 'bkt-1', '--ttl', '0s'], { json: true });
  });
});
