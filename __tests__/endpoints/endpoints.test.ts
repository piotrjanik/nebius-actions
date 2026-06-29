/**
 * Unit tests for the endpoints domain wrappers (endpoints/endpoints.ts).
 *
 * The SDK `EndpointService` is replaced with a tiny fake (no network, no SDK
 * construction). We assert the pure spec/metadata builders, the SDK->domain
 * mapping (incl. enum status + URL normalization), the create/get/delete flows
 * (incl. get-by-name on a name collision), and the status helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildEndpointSpec,
  buildEndpointMetadata,
  mapSdkEndpoint,
  deployEndpoint,
  getEndpoint,
  getEndpointByName,
  deleteEndpoint,
  isEndpointReady,
  isEndpointTerminalFailure,
  type EndpointServiceLike,
  type EndpointSpec,
} from '../../src/core/endpoints/endpoints';

const create = vi.fn();
const get = vi.fn();
const getByName = vi.fn();
const del = vi.fn();
const service = { create, get, getByName, delete: del } as unknown as EndpointServiceLike;

const op = (id: string) => ({ resourceId: () => id, raw: () => ({ op: true }) });

beforeEach(() => {
  create.mockReset();
  get.mockReset();
  getByName.mockReset();
  del.mockReset();
});

describe('buildEndpointMetadata', () => {
  it('builds {name} with no parentId by default', () => {
    expect(buildEndpointMetadata({ name: 'svc', image: 'img' })).toEqual({ name: 'svc' });
  });

  it('includes parentId when projectId is set', () => {
    expect(buildEndpointMetadata({ name: 'svc', image: 'img', projectId: 'proj' })).toEqual({
      name: 'svc',
      parentId: 'proj',
    });
  });

  it('throws when name is missing', () => {
    expect(() => buildEndpointMetadata({ image: 'img' } as EndpointSpec)).toThrow(
      /name is required/,
    );
  });
});

describe('buildEndpointSpec', () => {
  it('builds a minimal spec from image only', () => {
    expect(buildEndpointSpec({ name: 'svc', image: 'img' })).toEqual({ image: 'img' });
  });

  it('throws when image is missing', () => {
    expect(() => buildEndpointSpec({ name: 'svc' } as EndpointSpec)).toThrow(/image is required/);
  });

  it('maps optional fields to SDK spec fields', () => {
    const spec: EndpointSpec = {
      name: 'svc',
      image: 'img',
      port: 8080,
      preset: 'cpu',
      platform: 'cpu-plat',
      public: true,
      token: 't',
      env: { K: 'v', L: 'w' },
    };
    expect(buildEndpointSpec(spec)).toEqual({
      image: 'img',
      preset: 'cpu',
      platform: 'cpu-plat',
      publicIp: true,
      authToken: 't',
      ports: [{ containerPort: 8080 }],
      environmentVariables: [
        { name: 'K', value: 'v' },
        { name: 'L', value: 'w' },
      ],
    });
  });

  it('includes port 0 (uses !== undefined, not truthiness)', () => {
    expect(buildEndpointSpec({ name: 'svc', image: 'img', port: 0 }).ports).toEqual([
      { containerPort: 0 },
    ]);
  });
});

describe('mapSdkEndpoint', () => {
  it('reads id/name from metadata and status from the enum .name', () => {
    const ep = mapSdkEndpoint({
      metadata: { id: 'ep-1', name: 'svc' },
      status: { state: { name: 'RUNNING' }, publicEndpoints: ['https://svc.example'] },
    });
    expect(ep).toMatchObject({
      id: 'ep-1',
      name: 'svc',
      status: 'RUNNING',
      url: 'https://svc.example',
    });
  });

  it('normalizes a bare host in publicEndpoints to an https URL', () => {
    const ep = mapSdkEndpoint({
      metadata: { id: 'ep-1', name: 'svc' },
      status: { state: { name: 'RUNNING' }, publicEndpoints: ['svc.example/v1'] },
    });
    expect(ep.url).toBe('https://svc.example/v1');
  });

  it('accepts a plain string state', () => {
    expect(mapSdkEndpoint({ status: { state: 'ERROR' } }).status).toBe('ERROR');
  });

  it('defaults id/name to "" and status to UNKNOWN; url omitted when absent', () => {
    const ep = mapSdkEndpoint({});
    expect(ep.id).toBe('');
    expect(ep.name).toBe('');
    expect(ep.status).toBe('UNKNOWN');
    expect(ep.url).toBeUndefined();
  });
});

describe('deployEndpoint (create; get-by-name on conflict)', () => {
  it('creates and returns the endpoint id with a provisioning status', async () => {
    create.mockReturnValue({ result: Promise.resolve(op('ep-1')) });
    const ep = await deployEndpoint(service, { name: 'svc', image: 'img' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(ep).toMatchObject({ id: 'ep-1', name: 'svc', status: 'PROVISIONING' });
    expect(getByName).not.toHaveBeenCalled();
  });

  it('returns the existing endpoint via get-by-name on a name collision', async () => {
    create.mockReturnValue({ result: Promise.reject(new Error('endpoint already exists')) });
    getByName.mockResolvedValue({
      metadata: { id: 'ep-2', name: 'svc' },
      status: { state: { name: 'RUNNING' }, publicEndpoints: ['https://svc.example'] },
    });

    const ep = await deployEndpoint(service, { name: 'svc', image: 'img', projectId: 'proj' });

    expect(getByName).toHaveBeenCalledTimes(1);
    const req = getByName.mock.calls[0]![0] as { parentId: string; name: string };
    expect(req.parentId).toBe('proj');
    expect(req.name).toBe('svc');
    expect(ep).toMatchObject({ id: 'ep-2', status: 'RUNNING', url: 'https://svc.example' });
  });

  it('detects ALREADY_EXISTS by gRPC code 6', async () => {
    create.mockReturnValue({
      result: Promise.reject(Object.assign(new Error('boom'), { code: 6 })),
    });
    getByName.mockResolvedValue({
      metadata: { id: 'ep-2', name: 'svc' },
      status: { state: { name: 'RUNNING' } },
    });
    const ep = await deployEndpoint(service, { name: 'svc', image: 'img', projectId: 'proj' });
    expect(ep.id).toBe('ep-2');
  });

  it('propagates a conflict when no projectId is available (cannot resolve)', async () => {
    create.mockReturnValue({ result: Promise.reject(new Error('already exists')) });
    await expect(deployEndpoint(service, { name: 'svc', image: 'img' })).rejects.toThrow(
      /already exists/,
    );
    expect(getByName).not.toHaveBeenCalled();
  });

  it('propagates non-conflict create errors (no get-by-name fallback)', async () => {
    create.mockReturnValue({ result: Promise.reject(new Error('permission denied')) });
    await expect(
      deployEndpoint(service, { name: 'svc', image: 'img', projectId: 'proj' }),
    ).rejects.toThrow(/permission denied/);
    expect(getByName).not.toHaveBeenCalled();
  });
});

describe('getEndpoint / getEndpointByName / deleteEndpoint', () => {
  it('getEndpoint requests by id and maps the result', async () => {
    get.mockResolvedValue({
      metadata: { id: 'ep-1', name: 'svc' },
      status: { state: { name: 'RUNNING' } },
    });
    const ep = await getEndpoint(service, 'ep-1');
    expect((get.mock.calls[0]![0] as { id: string }).id).toBe('ep-1');
    expect(ep.status).toBe('RUNNING');
  });

  it('getEndpoint throws on empty id without calling the service', async () => {
    await expect(getEndpoint(service, '')).rejects.toThrow(/id is required/);
    expect(get).not.toHaveBeenCalled();
  });

  it('getEndpointByName requests {parentId,name}', async () => {
    getByName.mockResolvedValue({
      metadata: { id: 'ep-1', name: 'svc' },
      status: { state: { name: 'RUNNING' } },
    });
    await getEndpointByName(service, 'proj', 'svc');
    const req = getByName.mock.calls[0]![0] as { parentId: string; name: string };
    expect(req).toMatchObject({ parentId: 'proj', name: 'svc' });
  });

  it('getEndpointByName throws when projectId or name is missing', async () => {
    await expect(getEndpointByName(service, '', 'svc')).rejects.toThrow(/required/);
    await expect(getEndpointByName(service, 'proj', '')).rejects.toThrow(/required/);
    expect(getByName).not.toHaveBeenCalled();
  });

  it('deleteEndpoint deletes by id', async () => {
    del.mockReturnValue({ result: Promise.resolve(op('')) });
    await deleteEndpoint(service, 'ep-1');
    expect((del.mock.calls[0]![0] as { id: string }).id).toBe('ep-1');
  });

  it('deleteEndpoint throws on empty id without calling the service', async () => {
    await expect(deleteEndpoint(service, '')).rejects.toThrow(/id is required/);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('status helpers', () => {
  it('isEndpointReady is true for RUNNING (case-insensitive)', () => {
    for (const s of ['RUNNING', ' running ']) {
      expect(isEndpointReady(s)).toBe(true);
    }
  });

  it('isEndpointReady is false for in-flight / failure states', () => {
    for (const s of ['PROVISIONING', 'STARTING', 'STOPPED', 'ERROR', 'UNKNOWN']) {
      expect(isEndpointReady(s)).toBe(false);
    }
  });

  it('isEndpointTerminalFailure is true for ERROR (case-insensitive)', () => {
    for (const s of ['ERROR', ' error ']) {
      expect(isEndpointTerminalFailure(s)).toBe(true);
    }
  });

  it('isEndpointTerminalFailure is false for ready / in-flight states', () => {
    for (const s of ['RUNNING', 'PROVISIONING', 'STARTING', 'DELETING']) {
      expect(isEndpointTerminalFailure(s)).toBe(false);
    }
  });
});
