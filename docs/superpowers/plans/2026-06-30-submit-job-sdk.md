# submit-job (and run-job create) on the SDK — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move job creation from the `nebius` CLI to the `@nebius/js-sdk` `JobService.create` gRPC call, shared by the `submit-job` and `run-job` entrypoints.

**Architecture:** Mirror the existing endpoints domain (`src/core/endpoints/endpoints.ts`): a new `src/core/jobs/jobs-sdk.ts` with a narrow injected `JobServiceLike`, pure spec/request builders, and one I/O function `createJobViaSdk`. Polling, log streaming, and cancellation stay on the CLI (`jobs.ts`). The SDK reads `NEBIUS_IAM_TOKEN` (exported by the `auth` action).

**Tech Stack:** TypeScript (CommonJS, Node 24), `@nebius/js-sdk` 0.2.27, vitest, `@vercel/ncc` bundling via `scripts/build.mjs`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-30-submit-job-sdk-design.md`.
- No silent failures: every helper throws on bad input (matches repo convention).
- Pure builders are unit-tested without the SDK/CLI; the one I/O function is tested against a fake `JobServiceLike`. No network in tests.
- SDK deep types are imported from `@nebius/js-sdk/api/nebius/ai/v1/index` and `@nebius/js-sdk/runtime/protos/index` (both already mapped in `tsconfig.json` `paths`).
- `dist/` bundles are committed; rebuild with `npm run build` before the final commit.
- Verification gate: `npm run all` (lint → typecheck → test → build) must pass.

---

### Task 1: `parseSizeBytes` size-string helper

**Files:**
- Create: `src/core/size.ts`
- Test: `__tests__/size/size.test.ts`
- Modify: `src/core/index.ts` (add `export * from './size';`)

**Interfaces:**
- Produces: `parseSizeBytes(input: string): number` — bytes. Accepts a plain integer (`"1073741824"`) or a binary-suffixed value (`Ki/Mi/Gi/Ti`, e.g. `"250Gi"`). Throws on empty/unparseable input.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/size/size.test.ts
import { describe, it, expect } from 'vitest';
import { parseSizeBytes } from '../../src/core/size';

describe('parseSizeBytes', () => {
  it('parses binary suffixes (Ki/Mi/Gi/Ti)', () => {
    expect(parseSizeBytes('1Ki')).toBe(1024);
    expect(parseSizeBytes('2Mi')).toBe(2 * 1024 ** 2);
    expect(parseSizeBytes('250Gi')).toBe(250 * 1024 ** 3);
    expect(parseSizeBytes('1Ti')).toBe(1024 ** 4);
  });

  it('parses a plain byte count', () => {
    expect(parseSizeBytes('1073741824')).toBe(1073741824);
  });

  it('tolerates surrounding whitespace and is case-insensitive on the suffix', () => {
    expect(parseSizeBytes('  10gi ')).toBe(10 * 1024 ** 3);
  });

  it('throws on empty input', () => {
    expect(() => parseSizeBytes('')).toThrow(/size/i);
  });

  it('throws on an unparseable value', () => {
    expect(() => parseSizeBytes('big')).toThrow(/size/i);
    expect(() => parseSizeBytes('10Gb')).toThrow(/size/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/size/size.test.ts`
Expected: FAIL — cannot resolve `../../src/core/size`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/size.ts
/**
 * Parse a binary size string (Ki/Mi/Gi/Ti) or a plain byte count into bytes.
 *
 * Used to map the `disk-size` action input (e.g. `250Gi`) onto the SDK
 * `JobSpec.disk.sizeBytes` field. Binary units only (1Ki = 1024), matching how
 * Nebius disk sizes are expressed. Throws on anything it cannot parse — no
 * silent default.
 */
const UNITS: Record<string, number> = {
  '': 1,
  ki: 1024,
  mi: 1024 ** 2,
  gi: 1024 ** 3,
  ti: 1024 ** 4,
};

export function parseSizeBytes(input: string): number {
  const raw = (input ?? '').trim();
  if (raw === '') {
    throw new Error('parseSizeBytes: size is required.');
  }
  const m = /^(\d+)\s*(Ki|Mi|Gi|Ti)?$/i.exec(raw);
  if (!m) {
    throw new Error(`parseSizeBytes: unparseable size '${input}'.`);
  }
  const value = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  return value * UNITS[unit];
}
```

- [ ] **Step 4: Add the barrel export**

In `src/core/index.ts`, add after the `export * from './time';` line:

```ts
export * from './size';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/size/size.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/size.ts __tests__/size/size.test.ts src/core/index.ts
git commit -m "feat(core): add parseSizeBytes for disk-size mapping"
```

---

### Task 2: Extend domain `JobSpec`, add `CREATING` status

**Files:**
- Modify: `src/core/jobs/jobs.ts` (extend `JobSpec` interface only)
- Modify: `src/core/constants.ts` (add `creating: 'CREATING'` to `JOB_STATUS`)

**Interfaces:**
- Produces: domain `JobSpec` gains `args?: string`, `diskSizeBytes?: number`, `diskType?: string`, `preemptible?: boolean`. `JOB_STATUS.creating === 'CREATING'`.

This is a types-and-constant task with no behavior of its own; it is validated by `npm run typecheck` and consumed by Task 3.

- [ ] **Step 1: Extend the `JobSpec` interface**

In `src/core/jobs/jobs.ts`, replace the `JobSpec` interface with:

```ts
export interface JobSpec {
  name?: string;
  image: string;
  command?: string[];
  /** Container args string (e.g. `-c "axolotl train …"`); SDK `args`. */
  args?: string;
  preset?: string;
  platform?: string;
  env?: Record<string, string>;
  mounts?: string[];
  timeout?: string;
  /** Main-disk size in bytes; when set, the SDK `disk` block is built. */
  diskSizeBytes?: number;
  /** Disk type key (e.g. `network-ssd`); mapped to the SDK disk-type enum. */
  diskType?: string;
  /** Run the job on preemptible compute. */
  preemptible?: boolean;
  projectId?: string;
}
```

(Drop the old `extraArgs?: string[]` field — it has no SDK equivalent.)

- [ ] **Step 2: Add the `CREATING` status constant**

In `src/core/constants.ts`, add `creating` as the first member of `JOB_STATUS`:

```ts
export const JOB_STATUS = {
  creating: 'CREATING',
  queued: 'QUEUED',
  pending: 'PENDING',
  starting: 'STARTING',
  running: 'RUNNING',
  completed: 'COMPLETED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
} as const;
```

(Do NOT add it to `JOB_TERMINAL_STATUSES` — it is an initial, non-terminal status.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: errors only in `jobs.ts` / `inputs.ts` / `jobs.test.ts` that still reference `extraArgs` (fixed in Tasks 3–6). If the only errors are `extraArgs`-related, proceed; they are resolved by later tasks. To confirm in isolation, run: `npx tsc --noEmit src/core/constants.ts` is not meaningful — instead just verify the interface compiles by reading it back.

> Note: this task is committed together with Task 3 (its first real consumer), since `extraArgs` removal transiently breaks `inputs.ts`. Do not commit between Step 3 and Task 3.

---

### Task 3: `jobs-sdk.ts` — builders + `createJobViaSdk`

**Files:**
- Create: `src/core/jobs/jobs-sdk.ts`
- Test: `__tests__/jobs/jobs-sdk.test.ts`
- Modify: `src/core/jobs/index.ts` (export new surface)

**Interfaces:**
- Consumes: domain `JobSpec` (Task 2), `parseDurationMs` (`src/core/time.ts`), SDK `CreateJobRequest`, `JobSpec as SdkJobSpec`, `JobSpec_VolumeMount_Mode`, `DiskSpec_DiskType` from `@nebius/js-sdk/api/nebius/ai/v1/index`, `dayjs` from `@nebius/js-sdk/runtime/protos/index`, `JOB_STATUS` (Task 2).
- Produces:
  - `interface JobServiceLike { create(req): { result: Promise<OperationLike> } }`
  - `interface OperationLike { resourceId(): string; raw?(): unknown }`
  - `parseMount(m: string): { source: string; containerPath: string; mode: JobSpec_VolumeMount_Mode }`
  - `buildJobMetadata(s: JobSpec): { name?: string; parentId?: string }`
  - `buildJobSpec(s: JobSpec): SdkJobSpecPartial` (plain partial)
  - `buildCreateJobRequest(s: JobSpec): CreateJobRequest`
  - `createJobViaSdk(service: JobServiceLike, s: JobSpec): Promise<Job>` → `{ id, status: 'CREATING', raw }`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/jobs/jobs-sdk.test.ts
import { describe, it, expect } from 'vitest';
import {
  JobSpec_VolumeMount_Mode,
  DiskSpec_DiskType,
} from '@nebius/js-sdk/api/nebius/ai/v1/index';
import {
  parseMount,
  buildJobMetadata,
  buildJobSpec,
  buildCreateJobRequest,
  createJobViaSdk,
  type JobServiceLike,
  type OperationLike,
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

describe('createJobViaSdk', () => {
  it('returns the operation resource id and CREATING status', async () => {
    const op: OperationLike = { resourceId: () => 'job-xyz', raw: () => ({ op: true }) };
    let received: unknown;
    const fake: JobServiceLike = {
      create(req) {
        received = req;
        return { result: Promise.resolve(op) };
      },
    };
    const job = await createJobViaSdk(fake, { image: 'img', name: 'j' });
    expect(job.id).toBe('job-xyz');
    expect(job.status).toBe('CREATING');
    expect(received).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/jobs/jobs-sdk.test.ts`
Expected: FAIL — cannot resolve `../../src/core/jobs/jobs-sdk`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/jobs/jobs-sdk.ts
/**
 * Job creation over the `@nebius/js-sdk` `JobService` gRPC API (`nebius.ai.v1`).
 *
 * Mirrors the endpoints domain: pure builders map the domain `JobSpec` onto the
 * SDK `JobSpec`, and the single I/O function takes an injected `JobServiceLike`
 * so it is unit-testable with a fake (no SDK construction, no network).
 *
 * `create` returns a long-running Operation, not the Job — the new job id is
 * `op.resourceId()`. We return it with an initial `CREATING` status; the real
 * state is polled later by `wait-for-job` (still CLI-backed).
 *
 * Notes (verified against @nebius/js-sdk 0.2.27):
 *   - Proto `.create()` factories accept `DeepPartial`; a `Long` field accepts a
 *     plain `number`, so `disk.sizeBytes` is set as bytes directly.
 *   - `timeout` is a dayjs `Duration` (`dayjs.duration(ms)`).
 *   - Enum fields take SDK enum members (`JobSpec_VolumeMount_Mode.*`,
 *     `DiskSpec_DiskType.*`), not raw strings.
 */

import {
  CreateJobRequest,
  JobSpec as SdkJobSpec,
  JobSpec_VolumeMount_Mode,
  DiskSpec_DiskType,
} from '@nebius/js-sdk/api/nebius/ai/v1/index';
import { dayjs } from '@nebius/js-sdk/runtime/protos/index';
import { parseDurationMs } from '../time';
import { JOB_STATUS } from '../constants';
import type { Job, JobSpec } from './jobs';

/** Minimal Operation surface used here (satisfied by the SDK's Operation). */
export interface OperationLike {
  resourceId(): string;
  raw?(): unknown;
}

/** Minimal Job service surface (satisfied by the SDK's `JobService`). */
export interface JobServiceLike {
  create(req: CreateJobRequest): { result: Promise<OperationLike> };
}

/** Map the `disk-type` input key onto the SDK disk-type enum. */
const DISK_TYPES: Record<string, DiskSpec_DiskType> = {
  'network-ssd': DiskSpec_DiskType.NETWORK_SSD,
  'network-hdd': DiskSpec_DiskType.NETWORK_HDD,
  'network-ssd-non-replicated': DiskSpec_DiskType.NETWORK_SSD_NON_REPLICATED,
  'network-ssd-io-m3': DiskSpec_DiskType.NETWORK_SSD_IO_M3,
};

/**
 * Parse a `<source>:<containerPath>[:rw|ro]` mount string.
 * VERIFY: the SDK `VolumeMount.source` accepts a bucket id directly (the CLI
 * `--volume <bucket-id>:/path:rw` did). Defaults to read-write.
 */
export function parseMount(m: string): {
  source: string;
  containerPath: string;
  mode: JobSpec_VolumeMount_Mode;
} {
  const parts = m.split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`parseMount: malformed mount '${m}' (expected <source>:/path[:rw|ro]).`);
  }
  const [source, containerPath, modeRaw] = parts;
  const mode =
    (modeRaw ?? 'rw').toLowerCase() === 'ro'
      ? JobSpec_VolumeMount_Mode.READ_ONLY
      : JobSpec_VolumeMount_Mode.READ_WRITE;
  return { source, containerPath, mode };
}

/** Build the SDK `ResourceMetadata` partial (pure). */
export function buildJobMetadata(s: JobSpec): { name?: string; parentId?: string } {
  return {
    ...(s.name ? { name: s.name } : {}),
    ...(s.projectId ? { parentId: s.projectId } : {}),
  };
}

interface SdkJobSpecPartial {
  image: string;
  containerCommand?: string;
  args?: string;
  preset?: string;
  platform?: string;
  preemptible?: boolean;
  environmentVariables?: { name: string; value: string }[];
  volumes?: { source: string; containerPath: string; mode: JobSpec_VolumeMount_Mode }[];
  timeout?: ReturnType<typeof dayjs.duration>;
  disk?: { sizeBytes: number; type: DiskSpec_DiskType };
}

/** Build the SDK `JobSpec` partial from a domain spec (pure). */
export function buildJobSpec(s: JobSpec): SdkJobSpecPartial {
  if (!s.image) {
    throw new Error('JobSpec.image is required.');
  }
  const spec: SdkJobSpecPartial = { image: s.image };

  if (s.command && s.command.length > 0) spec.containerCommand = s.command.join(' ');
  if (s.args) spec.args = s.args;
  if (s.preset) spec.preset = s.preset;
  if (s.platform) spec.platform = s.platform;
  if (s.preemptible) spec.preemptible = true;

  const env = Object.entries(s.env ?? {});
  if (env.length > 0) {
    spec.environmentVariables = env.map(([name, value]) => ({ name, value }));
  }
  if (s.mounts && s.mounts.length > 0) {
    spec.volumes = s.mounts.map(parseMount);
  }
  const timeoutMs = parseDurationMs(s.timeout);
  if (timeoutMs !== undefined) {
    spec.timeout = dayjs.duration(timeoutMs);
  }
  if (s.diskSizeBytes !== undefined) {
    const typeKey = (s.diskType ?? 'network-ssd').toLowerCase();
    const type = DISK_TYPES[typeKey];
    if (type === undefined) {
      throw new Error(`buildJobSpec: unknown disk type '${s.diskType}'.`);
    }
    spec.disk = { sizeBytes: s.diskSizeBytes, type };
  }
  return spec;
}

/** Assemble the `CreateJobRequest` (pure). */
export function buildCreateJobRequest(s: JobSpec): CreateJobRequest {
  return CreateJobRequest.create({
    metadata: buildJobMetadata(s),
    spec: SdkJobSpec.create(buildJobSpec(s)),
  });
}

/** Create a job via the SDK; returns immediately with the new id + CREATING. */
export async function createJobViaSdk(service: JobServiceLike, s: JobSpec): Promise<Job> {
  const op = await service.create(buildCreateJobRequest(s)).result;
  return { id: op.resourceId(), status: JOB_STATUS.creating, raw: op.raw?.() ?? op };
}
```

- [ ] **Step 4: Export the new surface**

In `src/core/jobs/index.ts`, add after the `./jobs` export block:

```ts
export {
  createJobViaSdk,
  buildCreateJobRequest,
  buildJobSpec,
  buildJobMetadata,
  parseMount,
  type JobServiceLike,
  type OperationLike,
} from './jobs-sdk';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/jobs/jobs-sdk.test.ts`
Expected: PASS (all describes). If `parseDurationMs` returns `undefined` for `'1h'`, check its accepted units — it already backs `run-job`'s timeout, so `'1h'` is supported.

- [ ] **Step 6: Commit (includes Task 2)**

```bash
git add src/core/jobs/jobs-sdk.ts __tests__/jobs/jobs-sdk.test.ts src/core/jobs/index.ts src/core/jobs/jobs.ts src/core/constants.ts
git commit -m "feat(jobs): add SDK-based job creation (jobs-sdk)"
```

---

### Task 4: `jobService(sdk)` SDK client helper

**Files:**
- Modify: `src/core/sdk/client.ts` (add `jobService`)
- Modify: `src/core/sdk/index.ts` (export `jobService`)

**Interfaces:**
- Consumes: `JobServiceLike` (Task 3), SDK `JobService`, `SDK`.
- Produces: `jobService(sdk: SDK): JobServiceLike`.

Thin cast boundary (like `endpointService`); validated by typecheck, no unit test.

- [ ] **Step 1: Add the import and helper in `client.ts`**

Add `JobService` to the existing SDK api import in `src/core/sdk/client.ts`:

```ts
import { EndpointService, JobService } from '@nebius/js-sdk/api/nebius/ai/v1/index';
```

Add the `JobServiceLike` type import near the `EndpointServiceLike` import:

```ts
import type { JobServiceLike } from '../jobs/jobs-sdk';
```

Append this function at the end of the file:

```ts
/**
 * Build the Job service client for an SDK.
 *
 * Like `endpointService`, the generated client structurally satisfies the narrow
 * `JobServiceLike`, so we cast at this single boundary to keep the jobs domain
 * and its tests free of SDK type noise.
 */
export function jobService(sdk: SDK): JobServiceLike {
  return new JobService(sdk) as unknown as JobServiceLike;
}
```

- [ ] **Step 2: Export it**

In `src/core/sdk/index.ts`:

```ts
export { createSdk, endpointService, jobService } from './client';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS for `client.ts` / `sdk/index.ts` (any remaining errors are the `extraArgs` references in `inputs.ts` / `jobs.test.ts`, fixed in Tasks 5–6).

- [ ] **Step 4: Commit**

```bash
git add src/core/sdk/client.ts src/core/sdk/index.ts
git commit -m "feat(sdk): add jobService client helper"
```

---

### Task 5: Inputs — new fields, drop `extra-args`

**Files:**
- Modify: `src/core/jobs/inputs.ts`
- Test: `__tests__/jobs/inputs.test.ts` (create)

**Interfaces:**
- Consumes: `getString`/`getStringOrEnv`/`getBool`/`getMultiline`/`getKeyValues` (`src/core/io`), `parseSizeBytes` (Task 1), `PROJECT_ID_ENV`.
- Produces: `buildJobSpecFromInputs(): JobSpec` populating the extended fields; no longer reads `extra-args`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/jobs/inputs.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inputs = new Map<string, string>();
vi.mock('@actions/core', () => ({
  getInput: (name: string) => (inputs.get(name) ?? '').trim(),
  getMultilineInput: (name: string) => {
    const raw = inputs.get(name) ?? '';
    if (raw === '') return [];
    return raw.split('\n').filter((line, i, arr) => !(i === arr.length - 1 && line === ''));
  },
}));

import { buildJobSpecFromInputs } from '../../src/core/jobs/inputs';

function setInput(name: string, value: string): void {
  inputs.set(name, value);
}
beforeEach(() => inputs.clear());

describe('buildJobSpecFromInputs', () => {
  it('maps the demo inputs onto the domain JobSpec', () => {
    setInput('image', 'axolotl:main');
    setInput('name', 'demo');
    setInput('command', 'bash');
    setInput('args', '-c "axolotl train /workspace/data/config.yaml"');
    setInput('preset', '1gpu');
    setInput('platform', 'gpu-l40s-a');
    setInput('mounts', 'bkt-1:/workspace/data:rw');
    setInput('timeout', '1h');
    setInput('disk-size', '250Gi');
    setInput('disk-type', 'network-ssd');
    setInput('preemptible', 'true');
    setInput('project-id', 'proj-1');

    expect(buildJobSpecFromInputs()).toEqual({
      image: 'axolotl:main',
      name: 'demo',
      command: ['bash'],
      args: '-c "axolotl train /workspace/data/config.yaml"',
      preset: '1gpu',
      platform: 'gpu-l40s-a',
      mounts: ['bkt-1:/workspace/data:rw'],
      timeout: '1h',
      diskSizeBytes: 250 * 1024 ** 3,
      diskType: 'network-ssd',
      preemptible: true,
      projectId: 'proj-1',
    });
  });

  it('requires image', () => {
    expect(() => buildJobSpecFromInputs()).toThrow(/image/i);
  });

  it('omits disk-size and preemptible when unset', () => {
    setInput('image', 'img');
    const spec = buildJobSpecFromInputs();
    expect(spec.diskSizeBytes).toBeUndefined();
    expect(spec.preemptible).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/jobs/inputs.test.ts`
Expected: FAIL — `diskSizeBytes`/`args` not produced (and `extraArgs` still present).

- [ ] **Step 3: Rewrite `buildJobSpecFromInputs`**

Replace the body of `src/core/jobs/inputs.ts` with:

```ts
/**
 * Adapter from GitHub Actions inputs to a `JobSpec`.
 *
 * Shared by the `run-job` and `submit-job` entrypoints, which accept the same
 * job inputs and create the job via the SDK (`jobs-sdk.ts`). The SDK takes a
 * structured spec, so there is no raw `extra-args` passthrough — disk size,
 * disk type, preemptible, and container args are first-class inputs.
 */

import {
  getString,
  getStringOrEnv,
  getBool,
  getMultiline,
  getKeyValues,
} from '../io/inputs';
import { PROJECT_ID_ENV } from '../constants';
import { parseSizeBytes } from '../size';
import type { JobSpec } from './jobs';

/** Read the standard job inputs and assemble a `JobSpec` (image is required). */
export function buildJobSpecFromInputs(): JobSpec {
  const image = getString('image', { required: true });
  const name = getString('name');
  const command = getMultiline('command');
  const args = getString('args');
  const preset = getString('preset');
  const platform = getString('platform');
  const env = getKeyValues('env');
  const mounts = getMultiline('mounts');
  const timeout = getString('timeout');
  const diskSize = getString('disk-size');
  const diskType = getString('disk-type');
  const preemptible = getBool('preemptible', { default: false });
  // Optional: falls back to NEBIUS_PROJECT_ID (exported by setup); when neither
  // is set, parentId is omitted and the API uses the token's default project.
  const projectId = getStringOrEnv('project-id', PROJECT_ID_ENV);

  const spec: JobSpec = { image };
  if (name) spec.name = name;
  if (command.length > 0) spec.command = command;
  if (args) spec.args = args;
  if (preset) spec.preset = preset;
  if (platform) spec.platform = platform;
  if (Object.keys(env).length > 0) spec.env = env;
  if (mounts.length > 0) spec.mounts = mounts;
  if (timeout) spec.timeout = timeout;
  if (diskSize) spec.diskSizeBytes = parseSizeBytes(diskSize);
  if (diskType) spec.diskType = diskType;
  if (preemptible) spec.preemptible = true;
  if (projectId) spec.projectId = projectId;
  return spec;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/jobs/inputs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/jobs/inputs.ts __tests__/jobs/inputs.test.ts
git commit -m "feat(jobs): map disk-size/disk-type/preemptible/args inputs; drop extra-args"
```

---

### Task 6: Switch entrypoints to SDK create

**Files:**
- Modify: `src/entrypoints/submit-job.ts`
- Modify: `src/entrypoints/run-job.ts`

**Interfaces:**
- Consumes: `createSdk`, `jobService` (Task 4), `createJobViaSdk` (Task 3), `buildJobSpecFromInputs` (Task 5).

submit-job no longer touches the CLI. run-job creates via the SDK but KEEPS `ensureCli` for its CLI-backed poll + log streaming.

- [ ] **Step 1: Rewrite `submit-job.ts`**

```ts
/**
 * `submit-job` action entrypoint (low-level).
 *
 * Creates a Job via the SDK `JobService` and returns immediately (no waiting).
 * Requires the `auth` action to have exported NEBIUS_IAM_TOKEN.
 */

import {
  buildJobSpecFromInputs,
  createJobViaSdk,
  createSdk,
  jobService,
  fail,
  log,
  setOutput,
} from '../core';

async function run(): Promise<void> {
  const spec = buildJobSpecFromInputs();
  const service = jobService(createSdk());

  const job = await log.group('Create job', async () => {
    const j = await createJobViaSdk(service, spec);
    log.info(`Created job ${j.id} (status: ${j.status}).`);
    return j;
  });

  setOutput('job-id', job.id);
  setOutput('status', job.status);
}

run().catch((err) => fail(err));
```

- [ ] **Step 2: Update `run-job.ts` create step**

In `src/entrypoints/run-job.ts`:

Change the import block — remove `createJob`, add `createJobViaSdk`, `createSdk`, `jobService`:

```ts
import {
  buildJobSpecFromInputs,
  createJobViaSdk,
  createSdk,
  jobService,
  ensureCli,
  fail,
  getBool,
  getNumber,
  getJob,
  isJobSuccess,
  isJobTerminal,
  log,
  parseDurationMs,
  pollUntil,
  setOutput,
  streamJobLogs,
  DEFAULT_POLL_TIMEOUT_MS,
  POLL_TIMEOUT_BUFFER_MS,
  type Job,
} from '../core';
```

Replace the create block (keep `ensureCli` — the poll/logs path still uses the CLI):

```ts
  const created = await log.group('Create job', async () => {
    const service = jobService(createSdk());
    const job = await createJobViaSdk(service, spec);
    log.info(`Created job ${job.id} (status: ${job.status}).`);
    return job;
  });
```

(Leave the `await ensureCli({ version: 'latest' });` line and everything from `setOutput('job-id', …)` onward unchanged.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS except for the now-unused `createJob`/`buildCreateJobArgs` exports and the `extraArgs` references still in `jobs.test.ts` (removed in Task 7). Unused exports do not fail typecheck; if `jobs.test.ts` errors on `extraArgs`, that is expected and resolved next.

- [ ] **Step 4: Commit**

```bash
git add src/entrypoints/submit-job.ts src/entrypoints/run-job.ts
git commit -m "feat(jobs): create jobs via SDK in submit-job and run-job"
```

---

### Task 7: Remove dead CLI-create code

**Files:**
- Modify: `src/core/jobs/jobs.ts` (remove `buildCreateJobArgs`, `createJob`)
- Modify: `src/core/jobs/index.ts` (drop their exports)
- Modify: `__tests__/jobs/jobs.test.ts` (remove their tests + `extraArgs` references)

**Interfaces:**
- Produces: `jobs.ts` no longer exports `createJob` / `buildCreateJobArgs`. `getJob`, `cancelJob`, `streamJobLogs`, `mapJobJson`, status helpers remain.

- [ ] **Step 1: Delete `buildCreateJobArgs` and `createJob` from `jobs.ts`**

Remove the entire `buildCreateJobArgs` function (its doc comment through its `return args;` close) and the `createJob` function. Keep `extractExitCode`, `mapJobJson`, `getJob`, `cancelJob`, `streamJobLogs`, `isJobTerminal`, `isJobSuccess`. If the `JOB` group const is still used by `getJob`/`cancelJob`/`streamJobLogs` (it is), keep it.

- [ ] **Step 2: Drop the exports in `jobs/index.ts`**

Edit the `./jobs` export block to remove `createJob` and `buildCreateJobArgs`:

```ts
export {
  getJob,
  cancelJob,
  streamJobLogs,
  isJobTerminal,
  isJobSuccess,
  mapJobJson,
  type JobSpec,
  type Job,
} from './jobs';
```

- [ ] **Step 3: Remove the dead tests in `jobs.test.ts`**

- Delete the `describe('buildCreateJobArgs', …)` block entirely.
- In `describe('createJob / getJob / cancelJob / streamJobLogs (verb building)')`, delete the `createJob runs …` test; rename the describe to `getJob / cancelJob / streamJobLogs (verb building)`.
- Remove `buildCreateJobArgs` and `createJob` from the import list at the top of the file.
- Confirm no remaining reference to `extraArgs` exists (the removed `buildCreateJobArgs` test held the only one).

- [ ] **Step 4: Run the jobs tests**

Run: `npx vitest run __tests__/jobs/`
Expected: PASS — `jobs.test.ts`, `jobs-sdk.test.ts`, `inputs.test.ts` all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/jobs/jobs.ts src/core/jobs/index.ts __tests__/jobs/jobs.test.ts
git commit -m "refactor(jobs): remove dead CLI job-create path"
```

---

### Task 8: Update action.yml for submit-job and run-job

**Files:**
- Modify: `actions/submit-job/action.yml`
- Modify: `actions/run-job/action.yml`

**Interfaces:** none (declarative metadata).

- [ ] **Step 1: Edit `actions/submit-job/action.yml` inputs**

- Remove the `extra-args` input.
- Add these inputs (place near `timeout`):

```yaml
  args:
    description: 'Container args string passed to the entrypoint (e.g. -c "cmd").'
    required: false
  disk-size:
    description: 'Main disk size (binary units, e.g. 250Gi). Omit for the platform default.'
    required: false
  disk-type:
    description: 'Disk type: network-ssd (default), network-hdd, network-ssd-non-replicated, network-ssd-io-m3.'
    required: false
    default: 'network-ssd'
  preemptible:
    description: 'Run on preemptible compute.'
    required: false
    default: 'false'
```

- In the action `description`, add: "Authenticates via the SDK — run the `auth` action first (exports NEBIUS_IAM_TOKEN)."

- [ ] **Step 2: Apply the same input changes to `actions/run-job/action.yml`**

Make the identical edits (remove `extra-args`; add `args`, `disk-size`, `disk-type`, `preemptible`; note the `auth` requirement in the description). Leave run-job's `wait` / `poll-interval` inputs as they are.

- [ ] **Step 3: Sanity-check YAML**

Run: `node -e "const y=require('fs').readFileSync('actions/submit-job/action.yml','utf8'); if(/extra-args/.test(y)) throw new Error('extra-args still present'); console.log('submit-job ok')"`
Expected: prints `submit-job ok`.

- [ ] **Step 4: Commit**

```bash
git add actions/submit-job/action.yml actions/run-job/action.yml
git commit -m "feat(jobs): action inputs for SDK create (args/disk-size/disk-type/preemptible)"
```

---

### Task 9: Update the demo workflow

**Files:**
- Modify: `.github/workflows/demo-run-job.yml`

**Interfaces:** none.

- [ ] **Step 1: Add an `auth` step after `Set up Nebius`**

Immediately after the `Set up Nebius` (`./actions/setup`) step, add:

```yaml
      # Mint an IAM token for the SDK path (submit-job creates the Job via the
      # SDK, which reads NEBIUS_IAM_TOKEN). Key method — reuses the SA key.
      - name: Authenticate (SDK token)
        uses: ./actions/auth
        with:
          auth-method: key
          service-account-id: ${{ vars.NEBIUS_SERVICE_ACCOUNT_ID }}
          public-key-id: ${{ vars.NEBIUS_PUBLIC_KEY_ID }}
          private-key: ${{ secrets.NEBIUS_PRIVATE_KEY }}
```

- [ ] **Step 2: Replace the submit step's `extra-args` block**

In the `Submit Axolotl fine-tune` step, delete the entire `extra-args: |` block (and its preceding explanatory comment about `--args`/`--format json` ordering) and replace with:

```yaml
          disk-size: ${{ inputs.disk-size }}
          preemptible: true
          args: -c "axolotl train /workspace/data/config.yaml"
```

Keep `command: bash`, `timeout: 1h`, and the `mounts:` line. The `mounts` value stays `${{ steps.bucket.outputs.bucket-id }}:/workspace/data:rw`.

- [ ] **Step 3: Update the header `Auth:` comment**

In the top-of-file comment block, adjust the Auth note to read that `setup` configures the CLI profile (bucket ops + log streaming) AND the `auth` action exports an IAM token for the SDK job-create path.

- [ ] **Step 4: Sanity-check the workflow**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/demo-run-job.yml','utf8'); if(/extra-args/.test(y)) throw new Error('extra-args still present'); if(!/actions\/auth/.test(y)) throw new Error('auth step missing'); console.log('workflow ok')"`
Expected: prints `workflow ok`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/demo-run-job.yml
git commit -m "demo(run-job): auth step + typed disk-size/preemptible/args (SDK create)"
```

---

### Task 10: Rebuild bundles + full verification

**Files:**
- Modify: `actions/*/dist/index.js` (generated)

- [ ] **Step 1: Rebuild the dist bundles**

Run: `npm run build`
Expected: "Built 13 action bundle(s)".

- [ ] **Step 2: Run the full gate**

Run: `npm run all`
Expected: lint, typecheck, all vitest tests, and build all succeed (exit 0).

- [ ] **Step 3: Verify the SDK is bundled into submit-job and the CLI create is gone**

Run: `grep -c "JobService" actions/submit-job/dist/index.js`
Expected: ≥ 1 (the SDK JobService is bundled).

Run: `grep -c "container-command" actions/submit-job/dist/index.js`
Expected: `0` (the old CLI create flag is gone from this bundle).

- [ ] **Step 4: Commit the rebuilt bundles**

```bash
git add actions
git commit -m "build: regenerate dist bundles for SDK job create"
```

---

## Self-Review

**Spec coverage:**
- Auth via `auth`/`NEBIUS_IAM_TOKEN` → Tasks 6, 8 (doc), 9 (demo auth step). ✓
- Input surface (add args/disk-size/disk-type/preemptible, drop extra-args) → Tasks 5, 8. ✓
- Both entrypoints on SDK create → Task 6. ✓
- jobs-sdk mirrors endpoints (JobServiceLike, pure builders, createJobViaSdk) → Task 3. ✓
- `jobService` client helper → Task 4. ✓
- Return semantics (resourceId + CREATING, no follow-up get) → Tasks 2, 3. ✓
- Mount parsing, size parsing, duration/enum construction → Tasks 1, 3. ✓
- Remove dead CLI create code + tests → Task 7. ✓
- Testing (jobs-sdk fake service, pure builders) → Task 3, plus inputs Task 5. ✓
- Demo workflow → Task 9. ✓
- Rebuild dist + verify → Task 10. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `JobSpec` extended once (Task 2) and consumed with the same field names (`diskSizeBytes`, `diskType`, `preemptible`, `args`) in Tasks 3 and 5. `createJobViaSdk(service, spec)` signature matches between Task 3 (definition) and Task 6 (use). `jobService` / `JobServiceLike` names consistent across Tasks 3, 4, 6. ✓

**Known VERIFY item (carry into execution):** `JobSpec_VolumeMount.source` is assumed to accept a bucket id directly (the CLI `--volume <bucket-id>:/path:rw` did). If the live API rejects it, the mount may need `sourceConfig` instead — confirm against a real `submit-job` run before closing out.
