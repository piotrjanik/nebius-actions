/**
 * Unit tests for the jobs domain wrappers (jobs/jobs.ts).
 *
 * `runCli` (cli/exec) and `log` (io/log) are mocked so no CLI runs. We assert
 * pure arg-building, JSON->Job mapping, the verbs each operation invokes, and
 * the status helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCli = vi.fn();
const streamCli = vi.fn();
vi.mock('../../src/core/cli/exec', () => ({
  runCli: (...args: unknown[]) => runCli(...args),
  streamCli: (...args: unknown[]) => streamCli(...args),
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

import {
  mapJobJson,
  getJob,
  cancelJob,
  streamJobLogs,
  isJobTerminal,
  isJobSuccess,
} from '../../src/core/jobs/jobs';

beforeEach(() => {
  runCli.mockReset();
  streamCli.mockReset();
});

describe('mapJobJson', () => {
  it('reads id/status from common top-level fields', () => {
    const job = mapJobJson({ id: 'job-1', status: 'RUNNING' });
    expect(job).toMatchObject({ id: 'job-1', status: 'RUNNING' });
    expect(job.raw).toEqual({ id: 'job-1', status: 'RUNNING' });
  });

  it('falls back through nested metadata + status paths', () => {
    const job = mapJobJson({
      metadata: { id: 'm-1', name: 'nm' },
      status: { state: 'COMPLETED', exit_code: 0 },
    });
    expect(job.id).toBe('m-1');
    expect(job.name).toBe('nm');
    expect(job.status).toBe('COMPLETED');
    expect(job.exitCode).toBe(0);
  });

  it('extracts a numeric-string exit code', () => {
    const job = mapJobJson({ id: 'j', status: 'FAILED', exitCode: '137' });
    expect(job.exitCode).toBe(137);
  });

  it('defaults status to UNKNOWN and id to "" on an empty object', () => {
    const job = mapJobJson({});
    expect(job.id).toBe('');
    expect(job.status).toBe('UNKNOWN');
    expect(job.exitCode).toBeUndefined();
  });

  it('tolerates null/undefined raw', () => {
    expect(mapJobJson(undefined).status).toBe('UNKNOWN');
    expect(mapJobJson(null).status).toBe('UNKNOWN');
  });
});

describe('getJob / cancelJob / streamJobLogs (verb building)', () => {
  it('getJob runs `ai job get --id <id>` with json', async () => {
    runCli.mockResolvedValue({ data: { id: 'job-1', status: 'RUNNING' } });
    await getJob('job-1');
    expect(runCli.mock.calls[0]![0]).toEqual(['ai', 'job', 'get', '--id', 'job-1']);
    expect(runCli.mock.calls[0]![1]).toEqual({ json: true });
  });

  it('getJob throws on empty id without calling the CLI', async () => {
    await expect(getJob('')).rejects.toThrow(/id is required/);
    expect(runCli).not.toHaveBeenCalled();
  });

  it('cancelJob runs `ai job cancel --id <id>` and maps the returned job', async () => {
    runCli.mockResolvedValue({ data: { id: 'job-1', status: 'CANCELLED' } });
    const job = await cancelJob('job-1');
    expect(runCli.mock.calls[0]![0]).toEqual(['ai', 'job', 'cancel', '--id', 'job-1']);
    expect(job.status).toBe('CANCELLED');
  });

  it('cancelJob re-gets the job when cancel returns an operation (no id)', async () => {
    runCli
      .mockResolvedValueOnce({ data: { operationId: 'op-1' } }) // cancel -> operation, mapped id ""
      .mockResolvedValueOnce({ data: { id: 'job-1', status: 'CANCELLED' } }); // fallback get
    const job = await cancelJob('job-1');
    expect(runCli).toHaveBeenCalledTimes(2);
    expect(runCli.mock.calls[1]![0]).toEqual(['ai', 'job', 'get', '--id', 'job-1']);
    expect(job).toMatchObject({ id: 'job-1', status: 'CANCELLED' });
  });

  it('streamJobLogs streams `ai job logs <id> --follow` and returns a stoppable handle', () => {
    const stop = vi.fn();
    streamCli.mockReturnValue({ stop, done: Promise.resolve() });

    const stream = streamJobLogs('job-1');

    // The id is POSITIONAL here, unlike get/cancel which take --id.
    expect(streamCli.mock.calls[0]![0]).toEqual(['ai', 'job', 'logs', 'job-1', '--follow']);
    stream.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('streamJobLogs rejects an empty id', () => {
    expect(() => streamJobLogs('')).toThrow(/id is required/);
  });
});

describe('status helpers', () => {
  it.each([
    ['COMPLETED', true],
    ['FAILED', true],
    ['CANCELLED', true],
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
    for (const s of ['QUEUED', 'PENDING', 'STARTING', 'RUNNING', 'UNKNOWN']) {
      expect(isJobTerminal(s)).toBe(false);
    }
  });

  it('isJobSuccess is true only for COMPLETED (case-insensitive)', () => {
    expect(isJobSuccess('COMPLETED')).toBe(true);
    expect(isJobSuccess(' completed ')).toBe(true);
    for (const s of ['FAILED', 'CANCELLED', 'RUNNING']) {
      expect(isJobSuccess(s)).toBe(false);
    }
  });
});
