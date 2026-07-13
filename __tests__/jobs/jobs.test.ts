/**
 * Unit tests for the jobs domain (jobs/jobs.ts): CLI-backed log streaming and
 * the status helpers. `runCli`/`cliAvailable` (cli/exec) and `log` (io/log) are
 * mocked so no CLI runs. The job lifecycle (create/get/cancel) is SDK-backed —
 * see jobs-sdk.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCli = vi.fn();
const cliAvailable = vi.fn();
vi.mock('../../src/core/cli/exec', () => ({
  runCli: (...args: unknown[]) => runCli(...args),
  cliAvailable: (...args: unknown[]) => cliAvailable(...args),
}));

// streamJobLogs runs inside log.group; make it pass-through.
vi.mock('../../src/core/io/log', () => ({
  log: {
    group: <T>(_name: string, fn: () => Promise<T>) => fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mask: vi.fn(),
}));

import { log } from '../../src/core/io/log';
import {
  streamJobLogs,
  maybeStreamJobLogs,
  isJobTerminal,
  isJobSuccess,
} from '../../src/core/jobs/jobs';

beforeEach(() => {
  runCli.mockReset();
  cliAvailable.mockReset();
  vi.mocked(log.info).mockReset();
  vi.mocked(log.warn).mockReset();
});

describe('streamJobLogs', () => {
  it('runs `ai job logs <id> --follow` (non-json)', async () => {
    runCli.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await streamJobLogs('job-1');
    expect(runCli.mock.calls[0]![0]).toEqual(['ai', 'job', 'logs', 'job-1', '--follow']);
    // no json option -> raw stream
    expect(runCli.mock.calls[0]![1]).toBeUndefined();
  });

  it('throws on empty id without calling the CLI', async () => {
    await expect(streamJobLogs('')).rejects.toThrow(/id is required/);
    expect(runCli).not.toHaveBeenCalled();
  });
});

describe('maybeStreamJobLogs', () => {
  it('streams when the CLI is on PATH', async () => {
    cliAvailable.mockResolvedValue(true);
    runCli.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await maybeStreamJobLogs('job-1');
    expect(runCli).toHaveBeenCalledTimes(1);
  });

  it('skips with a notice when the CLI is missing', async () => {
    cliAvailable.mockResolvedValue(false);
    await maybeStreamJobLogs('job-1');
    expect(runCli).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('skipping log streaming'));
  });

  it('never throws when streaming fails (warns instead)', async () => {
    cliAvailable.mockResolvedValue(true);
    runCli.mockRejectedValue(new Error('boom'));
    await expect(maybeStreamJobLogs('job-1')).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('status helpers', () => {
  it.each([
    ['COMPLETED', true],
    ['FAILED', true],
    ['CANCELLED', true],
    ['ERROR', true],
    ['completed', true], // case-insensitive
    ' running ', // trimmed, non-terminal
  ] as Array<[string, boolean] | string>)('isJobTerminal handles %s', (entry) => {
    if (Array.isArray(entry)) {
      expect(isJobTerminal(entry[0])).toBe(entry[1]);
    } else {
      expect(isJobTerminal(entry)).toBe(false);
    }
  });

  it('isJobTerminal is false for in-flight states', () => {
    for (const s of ['PROVISIONING', 'STARTING', 'RUNNING', 'CANCELLING', 'UNKNOWN']) {
      expect(isJobTerminal(s)).toBe(false);
    }
  });

  it('isJobSuccess is true only for COMPLETED (case-insensitive)', () => {
    expect(isJobSuccess('COMPLETED')).toBe(true);
    expect(isJobSuccess(' completed ')).toBe(true);
    for (const s of ['FAILED', 'CANCELLED', 'RUNNING', 'ERROR']) {
      expect(isJobSuccess(s)).toBe(false);
    }
  });
});
