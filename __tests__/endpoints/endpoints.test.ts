/**
 * Unit tests for the endpoints domain wrappers (endpoints/endpoints.ts).
 *
 * `runCli` (cli/exec) is mocked so no CLI runs. We assert arg-building, the
 * apply (update-then-create) semantics, JSON->Endpoint mapping incl. URL
 * extraction, and the status helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCli = vi.fn();
vi.mock('../../src/core/cli/exec', () => ({
  runCli: (...args: unknown[]) => runCli(...args),
}));

import {
  buildDeployEndpointArgs,
  mapEndpointJson,
  deployEndpoint,
  getEndpoint,
  deleteEndpoint,
  isEndpointReady,
  isEndpointTerminalFailure,
  type EndpointSpec,
} from '../../src/core/endpoints/endpoints';

beforeEach(() => {
  runCli.mockReset();
});

describe('buildDeployEndpointArgs', () => {
  it('builds a minimal create command', () => {
    expect(buildDeployEndpointArgs({ name: 'svc', image: 'img' }, 'create')).toEqual([
      'ai',
      'endpoint',
      'create',
      '--name',
      'svc',
      '--image',
      'img',
    ]);
  });

  it('honors the verb (update)', () => {
    const args = buildDeployEndpointArgs({ name: 'svc', image: 'img' }, 'update');
    expect(args.slice(0, 3)).toEqual(['ai', 'endpoint', 'update']);
  });

  it('throws when name is missing', () => {
    expect(() => buildDeployEndpointArgs({ image: 'img' } as EndpointSpec, 'create')).toThrow(
      /name is required/,
    );
  });

  it('throws when image is missing', () => {
    expect(() => buildDeployEndpointArgs({ name: 'svc' } as EndpointSpec, 'create')).toThrow(
      /image is required/,
    );
  });

  it('maps optional fields (port, replicas, project, env) to flags', () => {
    const spec: EndpointSpec = {
      name: 'svc',
      image: 'img',
      port: 8080,
      preset: 'cpu',
      platform: 'cpu',
      minReplicas: 1,
      maxReplicas: 3,
      projectId: 'proj',
      env: { K: 'v' },
      extraArgs: ['--raw'],
    };
    expect(buildDeployEndpointArgs(spec, 'create')).toEqual([
      'ai',
      'endpoint',
      'create',
      '--name',
      'svc',
      '--image',
      'img',
      '--port',
      '8080',
      '--preset',
      'cpu',
      '--platform',
      'cpu',
      '--min-replicas',
      '1',
      '--max-replicas',
      '3',
      '--project-id',
      'proj',
      '--env',
      'K=v',
      '--raw',
    ]);
  });

  it('includes --port "0" when port is 0 (uses !== undefined, not truthiness)', () => {
    const args = buildDeployEndpointArgs({ name: 'svc', image: 'img', port: 0 }, 'create');
    expect(args).toContain('--port');
    expect(args[args.indexOf('--port') + 1]).toBe('0');
  });
});

describe('mapEndpointJson', () => {
  it('reads id/name/status/url from top-level fields', () => {
    const ep = mapEndpointJson({
      id: 'ep-1',
      name: 'svc',
      status: 'READY',
      url: 'https://svc.example',
    });
    expect(ep).toMatchObject({
      id: 'ep-1',
      name: 'svc',
      status: 'READY',
      url: 'https://svc.example',
    });
  });

  it('extracts a nested status.url', () => {
    const ep = mapEndpointJson({
      id: 'ep-1',
      name: 'svc',
      status: { state: 'ACTIVE', public_url: 'https://nested.example' },
    });
    // status maps from status.state; url from status.public_url
    expect(ep.status).toBe('ACTIVE');
    expect(ep.url).toBe('https://nested.example');
  });

  it('tries alternate URL field spellings', () => {
    expect(mapEndpointJson({ publicUrl: 'https://a' }).url).toBe('https://a');
    expect(mapEndpointJson({ endpoint_url: 'https://b' }).url).toBe('https://b');
  });

  it('defaults id/name to "" and status to UNKNOWN; url omitted when absent', () => {
    const ep = mapEndpointJson({});
    expect(ep.id).toBe('');
    expect(ep.name).toBe('');
    expect(ep.status).toBe('UNKNOWN');
    expect(ep.url).toBeUndefined();
  });
});

describe('deployEndpoint (apply = update-then-create)', () => {
  it('returns the update result when update succeeds', async () => {
    runCli.mockResolvedValue({ data: { id: 'ep-1', name: 'svc', status: 'UPDATING' } });
    const ep = await deployEndpoint({ name: 'svc', image: 'img' });

    expect(runCli).toHaveBeenCalledTimes(1);
    expect(runCli.mock.calls[0]![0]).toEqual([
      'ai',
      'endpoint',
      'update',
      '--name',
      'svc',
      '--image',
      'img',
    ]);
    expect(ep).toMatchObject({ id: 'ep-1', status: 'UPDATING' });
  });

  it('falls back to create when update reports not-found', async () => {
    runCli
      .mockRejectedValueOnce(new Error('endpoint not found'))
      .mockResolvedValueOnce({ data: { id: 'ep-2', name: 'svc', status: 'CREATING' } });

    const ep = await deployEndpoint({ name: 'svc', image: 'img' });

    expect(runCli).toHaveBeenCalledTimes(2);
    expect(runCli.mock.calls[0]![0]![2]).toBe('update');
    expect(runCli.mock.calls[1]![0]![2]).toBe('create');
    expect(ep).toMatchObject({ id: 'ep-2', status: 'CREATING' });
  });

  it('propagates non-not-found update errors (no silent fallback to create)', async () => {
    runCli.mockRejectedValueOnce(new Error('permission denied'));
    await expect(deployEndpoint({ name: 'svc', image: 'img' })).rejects.toThrow(
      /permission denied/,
    );
    expect(runCli).toHaveBeenCalledTimes(1); // never tried create
  });
});

describe('getEndpoint / deleteEndpoint', () => {
  it('getEndpoint runs `ai endpoint get --id <idOrName>` with json', async () => {
    runCli.mockResolvedValue({ data: { id: 'ep-1', name: 'svc', status: 'READY' } });
    await getEndpoint('ep-1');
    expect(runCli.mock.calls[0]![0]).toEqual(['ai', 'endpoint', 'get', '--id', 'ep-1']);
    expect(runCli.mock.calls[0]![1]).toEqual({ json: true });
  });

  it('getEndpoint throws on empty input without calling the CLI', async () => {
    await expect(getEndpoint('')).rejects.toThrow(/idOrName is required/);
    expect(runCli).not.toHaveBeenCalled();
  });

  it('deleteEndpoint runs `ai endpoint delete --id <idOrName>`', async () => {
    runCli.mockResolvedValue({ data: {} });
    await deleteEndpoint('ep-1');
    expect(runCli.mock.calls[0]![0]).toEqual(['ai', 'endpoint', 'delete', '--id', 'ep-1']);
  });

  it('deleteEndpoint throws on empty input without calling the CLI', async () => {
    await expect(deleteEndpoint('')).rejects.toThrow(/idOrName is required/);
    expect(runCli).not.toHaveBeenCalled();
  });
});

describe('status helpers', () => {
  it('isEndpointReady is true for READY/ACTIVE/RUNNING (case-insensitive)', () => {
    for (const s of ['READY', 'ACTIVE', 'RUNNING', ' ready ', 'active']) {
      expect(isEndpointReady(s)).toBe(true);
    }
  });

  it('isEndpointReady is false for in-flight / failure states', () => {
    for (const s of ['CREATING', 'DEPLOYING', 'PENDING', 'FAILED', 'UNKNOWN']) {
      expect(isEndpointReady(s)).toBe(false);
    }
  });

  it('isEndpointTerminalFailure is true for FAILED/ERROR (case-insensitive)', () => {
    for (const s of ['FAILED', 'ERROR', ' failed ', 'error']) {
      expect(isEndpointTerminalFailure(s)).toBe(true);
    }
  });

  it('isEndpointTerminalFailure is false for ready / in-flight states', () => {
    for (const s of ['READY', 'ACTIVE', 'CREATING', 'DELETING']) {
      expect(isEndpointTerminalFailure(s)).toBe(false);
    }
  });
});
