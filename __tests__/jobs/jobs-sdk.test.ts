import { describe, it, expect } from 'vitest';
import { JobSpec_VolumeMount_Mode } from '@nebius/js-sdk/api/nebius/ai/v1/index';
import { DiskSpec_DiskType } from '@nebius/js-sdk/api/nebius/compute/v1/index';
import {
  parseMount,
  buildJobMetadata,
  buildJobSpec,
  buildCreateJobRequest,
  createJobViaSdk,
  mapSdkJob,
  getJob,
  cancelJob,
  resolveSubnetId,
  type JobServiceLike,
  type OperationLike,
  type SubnetServiceLike,
} from '../../src/core/jobs/jobs-sdk';
import type { JobSpec } from '../../src/core/jobs/jobs';

describe('parseMount', () => {
  it('parses source:containerPath:rw into a READ_WRITE mount', () => {
    expect(parseMount('bkt-123:/workspace/data:rw')).toEqual({
      source: 'bkt-123',
      containerPath: '/workspace/data',
      mode: JobSpec_VolumeMount_Mode.READ_WRITE,
    });
  });

  it('parses :ro into a READ_ONLY mount', () => {
    expect(parseMount('bkt-123:/data:ro').mode).toBe(JobSpec_VolumeMount_Mode.READ_ONLY);
  });

  it('defaults to READ_WRITE when no mode suffix is given', () => {
    expect(parseMount('bkt-123:/data').mode).toBe(JobSpec_VolumeMount_Mode.READ_WRITE);
  });

  it('throws on a malformed mount (missing path)', () => {
    expect(() => parseMount('bkt-123')).toThrow(/mount/i);
  });
});

describe('buildJobMetadata', () => {
  it('maps name and projectId -> parentId', () => {
    expect(buildJobMetadata({ image: 'img', name: 'j', projectId: 'p' })).toEqual({
      name: 'j',
      parentId: 'p',
    });
  });

  it('omits absent fields', () => {
    expect(buildJobMetadata({ image: 'img' })).toEqual({});
  });
});

describe('buildJobSpec', () => {
  it('maps the full demo spec', () => {
    const s: JobSpec = {
      image: 'axolotl:main',
      command: ['bash'],
      args: '-c "axolotl train /workspace/data/config.yaml"',
      preset: '1gpu',
      platform: 'gpu-l40s-a',
      env: { HF_TOKEN: 'x' },
      mounts: ['bkt-1:/workspace/data:rw'],
      timeout: '1h',
      diskSizeBytes: 250 * 1024 ** 3,
      diskType: 'network-ssd',
      preemptible: true,
    };
    const spec = buildJobSpec(s);
    expect(spec.image).toBe('axolotl:main');
    expect(spec.containerCommand).toBe('bash');
    expect(spec.args).toBe('-c "axolotl train /workspace/data/config.yaml"');
    expect(spec.preset).toBe('1gpu');
    expect(spec.platform).toBe('gpu-l40s-a');
    expect(spec.environmentVariables).toEqual([{ name: 'HF_TOKEN', value: 'x' }]);
    expect(spec.volumes).toEqual([
      { source: 'bkt-1', containerPath: '/workspace/data', mode: JobSpec_VolumeMount_Mode.READ_WRITE },
    ]);
    expect(spec.preemptible).toBe(true);
    expect(spec.disk).toEqual({
      sizeBytes: 250 * 1024 ** 3,
      type: DiskSpec_DiskType.NETWORK_SSD,
    });
    // timeout is a dayjs duration of 1 hour
    expect(spec.timeout?.asMilliseconds()).toBe(60 * 60 * 1000);
  });

  it('joins a multi-element command into containerCommand', () => {
    expect(buildJobSpec({ image: 'img', command: ['python', 'train.py'] }).containerCommand).toBe('python train.py');
  });

  it('maps subnetId when provided, omits it otherwise', () => {
    expect(buildJobSpec({ image: 'img', subnetId: 'subnet-9' }).subnetId).toBe('subnet-9');
    expect(buildJobSpec({ image: 'img' }).subnetId).toBeUndefined();
  });

  it('omits disk when no size is given', () => {
    expect(buildJobSpec({ image: 'img' }).disk).toBeUndefined();
  });

  it('throws on an unknown disk type', () => {
    expect(() => buildJobSpec({ image: 'img', diskSizeBytes: 1, diskType: 'nvme' })).toThrow(
      /disk type/i,
    );
  });

  it('throws when image is missing', () => {
    expect(() => buildJobSpec({} as JobSpec)).toThrow(/image is required/);
  });
});

describe('buildCreateJobRequest', () => {
  it('wraps metadata + spec into a CreateJobRequest', () => {
    const req = buildCreateJobRequest({ image: 'img', name: 'j', projectId: 'p' });
    expect(req.metadata?.name).toBe('j');
    expect(req.metadata?.parentId).toBe('p');
    expect(req.spec?.image).toBe('img');
  });
});

const notCalled = () => {
  throw new Error('not expected in this test');
};

describe('createJobViaSdk', () => {
  it('returns the operation resource id and CREATING status', async () => {
    const op: OperationLike = { resourceId: () => 'job-xyz', raw: () => ({ op: true }) };
    let received: unknown;
    const fake: JobServiceLike = {
      create(req) {
        received = req;
        return { result: Promise.resolve(op) };
      },
      get: notCalled,
      cancel: notCalled,
    };
    const job = await createJobViaSdk(fake, { image: 'img', name: 'j' });
    expect(job.id).toBe('job-xyz');
    expect(job.status).toBe('CREATING');
    expect(received).toBeDefined();
  });
});

describe('mapSdkJob', () => {
  it('reads id/name from metadata and the state enum name from status', () => {
    const job = mapSdkJob({
      metadata: { id: 'job-1', name: 'trainer' },
      status: { state: { name: 'RUNNING' } },
    });
    expect(job).toMatchObject({ id: 'job-1', name: 'trainer', status: 'RUNNING' });
  });

  it('accepts a plain string state', () => {
    expect(mapSdkJob({ metadata: { id: 'j' }, status: { state: 'COMPLETED' } }).status).toBe(
      'COMPLETED',
    );
  });

  it('defaults status to UNKNOWN and id to "" on an empty object', () => {
    const job = mapSdkJob({});
    expect(job.id).toBe('');
    expect(job.status).toBe('UNKNOWN');
    expect(job.name).toBeUndefined();
    expect(job.exitCode).toBeUndefined();
  });

  it('tolerates null/undefined raw', () => {
    expect(mapSdkJob(undefined).status).toBe('UNKNOWN');
    expect(mapSdkJob(null).status).toBe('UNKNOWN');
  });
});

describe('getJob / cancelJob', () => {
  it('getJob fetches by id and maps the SDK job', async () => {
    let gotReq: unknown;
    const fake: JobServiceLike = {
      create: notCalled,
      get(req) {
        gotReq = req;
        return Promise.resolve({ metadata: { id: 'job-1' }, status: { state: { name: 'RUNNING' } } });
      },
      cancel: notCalled,
    };
    const job = await getJob(fake, 'job-1');
    expect(job).toMatchObject({ id: 'job-1', status: 'RUNNING' });
    expect((gotReq as { id: string }).id).toBe('job-1');
  });

  it('getJob throws on empty id without calling the service', async () => {
    const fake: JobServiceLike = { create: notCalled, get: notCalled, cancel: notCalled };
    await expect(getJob(fake, '')).rejects.toThrow(/id is required/);
  });

  it('cancelJob awaits the cancel operation and re-gets the job', async () => {
    const calls: string[] = [];
    const op: OperationLike = { resourceId: () => 'job-1' };
    const fake: JobServiceLike = {
      create: notCalled,
      get() {
        calls.push('get');
        return Promise.resolve({ metadata: { id: 'job-1' }, status: { state: { name: 'CANCELLED' } } });
      },
      cancel() {
        calls.push('cancel');
        return { result: Promise.resolve(op) };
      },
    };
    const job = await cancelJob(fake, 'job-1');
    expect(calls).toEqual(['cancel', 'get']);
    expect(job).toMatchObject({ id: 'job-1', status: 'CANCELLED' });
  });

  it('cancelJob throws on empty id without calling the service', async () => {
    const fake: JobServiceLike = { create: notCalled, get: notCalled, cancel: notCalled };
    await expect(cancelJob(fake, '')).rejects.toThrow(/id is required/);
  });
});

describe('resolveSubnetId', () => {
  it('returns the first subnet id in the project', async () => {
    let listedParent: string | undefined;
    const fake: SubnetServiceLike = {
      list(req) {
        listedParent = (req as unknown as { parentId: string }).parentId;
        return Promise.resolve({
          items: [{ metadata: { id: 'subnet-1' } }, { metadata: { id: 'subnet-2' } }],
        });
      },
    };
    expect(await resolveSubnetId(fake, 'proj-1')).toBe('subnet-1');
    expect(listedParent).toBe('proj-1');
  });

  it('throws when no project id is given', async () => {
    const fake: SubnetServiceLike = { list: () => Promise.resolve({ items: [] }) };
    await expect(resolveSubnetId(fake, '')).rejects.toThrow(/project id is required/i);
  });

  it('throws when the project has no subnets', async () => {
    const fake: SubnetServiceLike = { list: () => Promise.resolve({ items: [] }) };
    await expect(resolveSubnetId(fake, 'proj-1')).rejects.toThrow(/no subnets/i);
  });
});
