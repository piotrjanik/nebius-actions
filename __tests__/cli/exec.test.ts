/**
 * Unit tests for the CLI exec wrapper (cli/exec.ts).
 *
 * No real CLI: `@actions/exec` is mocked. We assert the binary, the args
 * (including `--format json` in json mode), JSON parsing, error behavior on
 * nonzero exit, and the ignoreReturnCode path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getExecOutput = vi.fn();
vi.mock('@actions/exec', () => ({
  getExecOutput: (...args: unknown[]) => getExecOutput(...args),
}));

import { runCli, withJsonFormat } from '../../src/core/cli/exec';
import { CLI_BINARY_NAME } from '../../src/core/constants';

/** Build an ExecOutput-shaped result. */
function execOut(exitCode: number, stdout = '', stderr = '') {
  return { exitCode, stdout, stderr };
}

beforeEach(() => {
  getExecOutput.mockReset();
});

describe('withJsonFormat', () => {
  it('appends --format json', () => {
    expect(withJsonFormat(['ai', 'job', 'get'])).toEqual(['ai', 'job', 'get', '--format', 'json']);
  });

  it('does not double-append when --format already present', () => {
    const args = ['ai', 'job', 'get', '--format', 'yaml'];
    expect(withJsonFormat(args)).toEqual(args);
  });

  it('inserts --format json BEFORE --args if present', () => {
    const args = ['ai', 'job', 'create', '--image', 'img', '--args', 'ls'];
    const result = withJsonFormat(args);
    const argsIndex = result.indexOf('--args');
    const formatIndex = result.indexOf('--format');
    expect(formatIndex).toBeLessThan(argsIndex);
    expect(result[formatIndex + 1]).toBe('json');
    expect(result.slice(argsIndex)).toEqual(['--args', 'ls']);
  });
});

describe('runCli', () => {
  it('invokes the nebius binary with the given args (non-json)', async () => {
    getExecOutput.mockResolvedValue(execOut(0, 'hello'));
    const res = await runCli(['version']);

    expect(getExecOutput).toHaveBeenCalledTimes(1);
    const [bin, args] = getExecOutput.mock.calls[0]!;
    expect(bin).toBe(CLI_BINARY_NAME);
    expect(args).toEqual(['version']);
    expect(res).toMatchObject({ exitCode: 0, stdout: 'hello' });
    expect(res.data).toBeUndefined();
  });

  it('always passes ignoreReturnCode:true to exec so it can craft its own errors', async () => {
    getExecOutput.mockResolvedValue(execOut(0, '{}'));
    await runCli(['ai', 'job', 'get'], { json: true });
    const opts = getExecOutput.mock.calls[0]![2] as { ignoreReturnCode?: boolean };
    expect(opts.ignoreReturnCode).toBe(true);
  });

  it('appends --format json and parses JSON into data when json:true', async () => {
    getExecOutput.mockResolvedValue(execOut(0, '{"id":"job-1","status":"RUNNING"}'));
    const res = await runCli<{ id: string; status: string }>(['ai', 'job', 'get'], {
      json: true,
    });

    const args = getExecOutput.mock.calls[0]![1] as string[];
    expect(args).toEqual(['ai', 'job', 'get', '--format', 'json']);
    expect(res.data).toEqual({ id: 'job-1', status: 'RUNNING' });
  });

  it('leaves data undefined for an empty stdout in json mode', async () => {
    getExecOutput.mockResolvedValue(execOut(0, '   '));
    const res = await runCli(['ai', 'job', 'get'], { json: true });
    expect(res.data).toBeUndefined();
  });

  it('throws on nonzero exit, embedding stderr', async () => {
    getExecOutput.mockResolvedValue(execOut(2, '', 'boom: bad request'));
    await expect(runCli(['ai', 'job', 'get'])).rejects.toThrow(/exit 2/);
    await expect(runCli(['ai', 'job', 'get'])).rejects.toThrow(/boom: bad request/);
  });

  it('falls back to stdout in the error when stderr is empty', async () => {
    getExecOutput.mockResolvedValue(execOut(1, 'stdout detail', ''));
    await expect(runCli(['ai', 'job', 'get'])).rejects.toThrow(/stdout detail/);
  });

  it('does NOT throw on nonzero exit when ignoreReturnCode is set', async () => {
    getExecOutput.mockResolvedValue(execOut(7, 'out', 'err'));
    const res = await runCli(['ai', 'job', 'get'], { ignoreReturnCode: true });
    expect(res).toMatchObject({ exitCode: 7, stdout: 'out', stderr: 'err' });
  });

  it('skips JSON parsing when exit is nonzero but ignored', async () => {
    getExecOutput.mockResolvedValue(execOut(1, 'not json', 'warn'));
    const res = await runCli(['ai', 'job', 'get'], { json: true, ignoreReturnCode: true });
    expect(res.data).toBeUndefined();
    expect(res.exitCode).toBe(1);
  });

  it('throws when json:true but stdout is invalid JSON on success', async () => {
    getExecOutput.mockResolvedValue(execOut(0, 'definitely-not-json'));
    await expect(runCli(['ai', 'job', 'get'], { json: true })).rejects.toThrow(
      /did not return valid JSON/,
    );
  });

  it('merges opts.env over process.env when env is supplied', async () => {
    getExecOutput.mockResolvedValue(execOut(0, ''));
    await runCli(['version'], { env: { NEBIUS_IAM_TOKEN: 'tok' } });
    const opts = getExecOutput.mock.calls[0]![2] as { env?: Record<string, string> };
    expect(opts.env).toBeDefined();
    expect(opts.env!.NEBIUS_IAM_TOKEN).toBe('tok');
    // process.env is spread in too
    expect(opts.env!.PATH ?? opts.env!.Path).toBeDefined();
  });

  it('passes through silent option', async () => {
    getExecOutput.mockResolvedValue(execOut(0, ''));
    await runCli(['version'], { silent: true });
    const opts = getExecOutput.mock.calls[0]![2] as { silent?: boolean };
    expect(opts.silent).toBe(true);
  });
});
