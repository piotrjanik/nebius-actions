import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCli = vi.fn();
vi.mock('../../src/core/cli/exec', () => ({ runCli: (...a: unknown[]) => runCli(...a) }));
vi.mock('../../src/core/io/log', () => ({ mask: vi.fn(), log: { info: vi.fn() } }));

import { mask } from '../../src/core/io/log';
import {
  buildMintKeyArgs,
  mintEphemeralKey,
  readAccessKeySecret,
} from '../../src/core/storage/keys';

beforeEach(() => {
  runCli.mockReset();
  vi.mocked(mask).mockReset();
});

describe('buildMintKeyArgs', () => {
  it('builds the access-key create command with required flags', () => {
    expect(
      buildMintKeyArgs({ projectId: 'proj-1', serviceAccountId: 'sa-1', name: 'k', expiresAt: '2026-06-30T00:00:00Z' }),
    ).toEqual([
      'iam', 'v2', 'access-key', 'create',
      '--parent-id', 'proj-1',
      '--account-service-account-id', 'sa-1',
      '--secret-delivery-mode', 'mystery_box',
      '--name', 'k',
      '--expires-at', '2026-06-30T00:00:00Z',
    ]);
  });

  it('omits optional flags when absent', () => {
    expect(buildMintKeyArgs({ projectId: 'p', serviceAccountId: 's' })).toEqual([
      'iam', 'v2', 'access-key', 'create',
      '--parent-id', 'p',
      '--account-service-account-id', 's',
      '--secret-delivery-mode', 'mystery_box',
    ]);
  });

  it('throws when projectId is missing', () => {
    expect(() => buildMintKeyArgs({ projectId: '', serviceAccountId: 's' })).toThrow(/projectId/);
  });

  it('throws when serviceAccountId is missing', () => {
    expect(() => buildMintKeyArgs({ projectId: 'p', serviceAccountId: '' })).toThrow(/serviceAccountId/);
  });
});

describe('mintEphemeralKey', () => {
  it('parses ids from the create JSON (tolerant field probing)', async () => {
    runCli.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      data: {
        metadata: { id: 'ak-123' },
        status: { aws_access_key_id: 'AKIA...', secret_id: 'mbx-9' },
      },
    });
    const m = await mintEphemeralKey({ projectId: 'p', serviceAccountId: 's' });
    expect(m).toEqual({ accessKeyId: 'ak-123', awsAccessKeyId: 'AKIA...', secretId: 'mbx-9' });
    expect(runCli).toHaveBeenCalledWith(expect.arrayContaining(['access-key', 'create']), { json: true, silent: true });
  });

  it('passes silent:true to runCli to avoid echoing the create response', async () => {
    runCli.mockResolvedValueOnce({
      exitCode: 0, stdout: '', stderr: '',
      data: {
        metadata: { id: 'ak-999' },
        status: { aws_access_key_id: 'AKIA...', secret_id: 'mbx-1' },
      },
    });
    await mintEphemeralKey({ projectId: 'p', serviceAccountId: 's' });
    expect(runCli).toHaveBeenCalledWith(expect.arrayContaining(['access-key', 'create']), { json: true, silent: true });
  });

  it('throws when the access key id is missing', async () => {
    runCli.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', data: {} });
    await expect(mintEphemeralKey({ projectId: 'p', serviceAccountId: 's' })).rejects.toThrow(/access key/i);
  });
});

describe('readAccessKeySecret', () => {
  it('reads and returns the secret for the access key id', async () => {
    runCli.mockResolvedValueOnce({
      exitCode: 0, stdout: '', stderr: '',
      data: { secret: 'SECRET-XYZ' },
    });
    const s = await readAccessKeySecret('ak-123');
    expect(s).toBe('SECRET-XYZ');
    expect(runCli).toHaveBeenCalledWith(
      ['iam', 'v2', 'access-key', 'get-secret', '--id', 'ak-123'],
      { json: true, silent: true },
    );
    expect(mask).toHaveBeenCalledWith('SECRET-XYZ');
  });
});
