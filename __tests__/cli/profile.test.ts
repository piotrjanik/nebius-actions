/**
 * Unit tests for the key-based CLI profile configuration (cli/profile.ts).
 *
 * `runCli` and `node:fs` are mocked: no CLI is executed and no file is written.
 * `@actions/core` is mocked so we can assert the private key is masked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCli = vi.fn();
vi.mock('../../src/core/cli/exec', () => ({
  runCli: (args: string[], opts?: unknown) => runCli(args, opts),
}));

const writeFile = vi.fn();
vi.mock('node:fs', () => ({
  promises: { writeFile: (...a: unknown[]) => writeFile(...a) },
}));

const setSecret = vi.fn();
vi.mock('@actions/core', () => ({
  setSecret: (s: string) => setSecret(s),
}));

import { configureCliProfile } from '../../src/core/cli/profile';

const base = {
  serviceAccountId: 'serviceaccount-xyz',
  publicKeyId: 'publickey-abc',
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n',
};

beforeEach(() => {
  runCli.mockReset().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  writeFile.mockReset().mockResolvedValue(undefined);
  setSecret.mockReset();
  process.env.RUNNER_TEMP = '/tmp/runner';
});

describe('configureCliProfile', () => {
  it('masks the private key and writes it to a 0600 file under RUNNER_TEMP', async () => {
    await configureCliProfile(base);

    expect(setSecret).toHaveBeenCalledWith(base.privateKeyPem);
    const [filePath, , opts] = writeFile.mock.calls[0]!;
    expect(filePath).toBe('/tmp/runner/nebius-sa-private-key.pem');
    expect(opts).toMatchObject({ mode: 0o600 });
  });

  it('creates a key-based profile then activates it', async () => {
    await configureCliProfile({ ...base, parentId: 'project-1', tenantId: 'tenant-1' });

    const [createArgs] = runCli.mock.calls[0]!;
    expect(createArgs).toEqual([
      'profile',
      'create',
      'ci',
      '--endpoint',
      'api.nebius.cloud',
      '--service-account-id',
      'serviceaccount-xyz',
      '--public-key-id',
      'publickey-abc',
      '--private-key-file-path',
      '/tmp/runner/nebius-sa-private-key.pem',
      '--parent-id',
      'project-1',
      '--tenant-id',
      'tenant-1',
    ]);
    expect(runCli.mock.calls[1]![0]).toEqual(['profile', 'activate', 'ci']);
  });

  it('honors custom name and endpoint and omits unset parent/tenant', async () => {
    await configureCliProfile({ ...base, name: 'prod', endpoint: 'api.eu.nebius.cloud' });

    const [createArgs] = runCli.mock.calls[0]!;
    expect(createArgs).toContain('prod');
    expect(createArgs).toContain('api.eu.nebius.cloud');
    expect(createArgs).not.toContain('--parent-id');
    expect(createArgs).not.toContain('--tenant-id');
    expect(runCli.mock.calls[1]![0]).toEqual(['profile', 'activate', 'prod']);
  });

  it('throws when serviceAccountId is missing (no file, no CLI)', async () => {
    await expect(configureCliProfile({ ...base, serviceAccountId: '' })).rejects.toThrow(
      /serviceAccountId/,
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(runCli).not.toHaveBeenCalled();
  });

  it('throws when publicKeyId is missing', async () => {
    await expect(configureCliProfile({ ...base, publicKeyId: '' })).rejects.toThrow(/publicKeyId/);
    expect(runCli).not.toHaveBeenCalled();
  });

  it('throws when privateKeyPem is missing', async () => {
    await expect(configureCliProfile({ ...base, privateKeyPem: '' })).rejects.toThrow(
      /privateKeyPem/,
    );
    expect(writeFile).not.toHaveBeenCalled();
  });
});
