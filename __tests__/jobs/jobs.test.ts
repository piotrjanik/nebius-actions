/**
 * Unit tests for the jobs domain wrappers (jobs/jobs.ts).
 *
 * `runCli` (cli/exec) and `log` (io/log) are mocked so no CLI runs. We assert
 * pure arg-building, JSON->Job mapping, the verbs each operation invokes, and
 * the status helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCli = vi.fn();
vi.mock('../../src/core/cli/exec', () => ({
  runCli: (...args: unknown[]) => runCli(...args),
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
  buildCreateJobArgs,
  mapJobJson,
  createJob,
  getJob,
  cancelJob,
  streamJobLogs,
  isJobTerminal,
  isJobSuccess,
  type JobSpec,
} from '../../src/core/jobs/jobs';

beforeEach(() => {
  runCli.mockReset();
});

describe('buildCreateJobArgs', () => {
  it('builds a minimal create command with the ai job group', () => {
    expect(buildCreateJobArgs({ image: 'ubuntu:22.04' })).toEqual([
      'ai',
      'job',
      'create',
      '--image',
      'ubuntu:22.04',
    ]);
  });

  it('throws when image is missing', () => {
    expect(() => buildCreateJobArgs({} as JobSpec)).toThrow(/image is required/);
  });

  it('maps every spec field to the confirmed flags in order', () => {
    const spec: JobSpec = {
      name: 'train',
      image: 'img:1',
      preset: 'gpu-h100',
      platform: 'gpu',
      projectId: 'proj-1',
      timeout: '1h',
      env: { A: '1', B: '2' },
      mounts: ['/data:/data'],
      command: ['python', 'train.py'],
    };
    expect(buildCreateJobArgs(spec)).toEqual([
      'ai',
      'job',
      'create',
      '--name',
      'train',
      '--image',
      'img:1',
      '--preset',
      'gpu-h100',
      '--platform',
      'gpu',
      '--parent-id',
      'proj-1',
      '--timeout',
      '1h',
      '--env',
      'A=1',
      '--env',
      'B=2',
      '--volume',
      '/data:/data',
      '--container-command',
      'python train.py',
    ]);
  });

  it('appends extraArgs last as raw passthrough', () => {
    const args = buildCreateJobArgs({ image: 'img', extraArgs: ['--foo', 'bar'] });
    expect(args.slice(-2)).toEqual(['--foo', 'bar']);
  });

  it('omits the command flag when command is empty', () => {
    const args = buildCreateJobArgs({ image: 'img', command: [] });
    expect(args).not.toContain('--container-command');
  });
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

describe('createJob / getJob / cancelJob / streamJobLogs (verb building)', () => {
  it('createJob runs `ai job create ...` with json and maps the result', async () => {
    runCli.mockResolvedValue({ data: { id: 'job-9', status: 'QUEUED' } });
    const job = await createJob({ image: 'img' });

    const [args, opts] = runCli.mock.calls[0]!;
    expect(args).toEqual(['ai', 'job', 'create', '--image', 'img']);
    expect(opts).toEqual({ json: true });
    expect(job).toMatchObject({ id: 'job-9', status: 'QUEUED' });
  });

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

  it('streamJobLogs runs `ai job logs --id <id>` (non-json)', async () => {
    runCli.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await streamJobLogs('job-1');
    expect(runCli.mock.calls[0]![0]).toEqual(['ai', 'job', 'logs', '--id', 'job-1']);
    // no json option -> raw stream
    expect(runCli.mock.calls[0]![1]).toBeUndefined();
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
