# Bucket-mounted Axolotl config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the base64-embedded Axolotl config in `demo-run-job` with a new reusable `upload-object` action that uploads an inlined config to a pre-existing Nebius bucket, which the job then mounts.

**Architecture:** A new `src/core/storage/` module mints a short-lived S3 access key from the already-configured service account (`nebius iam v2 access-key create … --secret-delivery-mode mystery_box`), uploads a local file via `@aws-sdk/client-s3` to the Nebius S3 endpoint, and returns the object URI plus the MysteryBox secret id. A thin `src/entrypoints/upload-object.ts` wires inputs→core→outputs, bundled to `actions/upload-object/dist/` by `scripts/build.mjs`. The workflow inlines the config, calls the action, and mounts the bucket with `:ro:default@<secret-id>`.

**Tech Stack:** TypeScript (CommonJS, node24), `@actions/core`, `@actions/exec`, `@aws-sdk/client-s3`, `nebius` CLI, vitest, `@vercel/ncc` (via `scripts/build.mjs`).

## Global Constraints

- Node `>=24`; package `type: "commonjs"`.
- Entrypoints import only from the `../core` barrel; core sub-modules import from siblings. New core code MUST be re-exported through `src/core/index.ts`.
- Every action's `dist/` is committed (no `.gitignore` of `dist/`); regenerate with `npm run build` (which derives actions from `src/entrypoints/*.ts`).
- No silent failures: nonzero CLI exit throws (handled by `runCli`); the entrypoint ends with `run().catch((err) => fail(err))`.
- Secrets MUST be passed to `mask()` before any further use or logging.
- CLI JSON field names are not fully guaranteed: probe candidate paths with `firstString(obj, [...])` (the existing repo pattern) and mark unverified paths with `// VERIFY:`.
- No new GitHub **secrets**; the only new config is `vars.NEBIUS_CONFIG_BUCKET`.
- Validate the whole change with `npm run all` (lint + typecheck + test + build) before the final commit.

---

## File structure

- Create `src/core/storage/keys.ts` — mint ephemeral access key + read its secret (CLI wrappers + pure arg-builder).
- Create `src/core/storage/s3.ts` — `@aws-sdk/client-s3` PutObject wrapper + pure URI/config builders.
- Create `src/core/storage/upload.ts` — `uploadObject()` orchestration + `buildUploadSpecFromInputs()`.
- Create `src/core/storage/index.ts` — module barrel.
- Modify `src/core/index.ts` — add `export * from './storage';`.
- Modify `src/core/constants.ts` — add S3 endpoint/region defaults and CLI command groups.
- Create `src/entrypoints/upload-object.ts` — the action entrypoint.
- Create `actions/upload-object/action.yml` — action metadata + IO.
- Generated `actions/upload-object/dist/` — via `npm run build`.
- Create `__tests__/storage/keys.test.ts`, `__tests__/storage/s3.test.ts`, `__tests__/storage/upload.test.ts`.
- Modify `package.json` — add `@aws-sdk/client-s3` dependency.
- Modify `.github/workflows/demo-run-job.yml` — inline config, upload step, bucket mount.
- Delete `examples/axolotl/config.yaml` — now inlined in the workflow.
- Modify `README.md` — add the `upload-object` row + usage note.

---

## Task 1: Dependency + storage constants

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/core/constants.ts` (append a Storage section)
- Test: `__tests__/storage/s3.test.ts` (created here, asserts constants import)

**Interfaces:**
- Consumes: nothing.
- Produces: `@aws-sdk/client-s3` available; constants `S3_ENDPOINT_DEFAULT: string`, `S3_REGION_DEFAULT: string`, `CLI_ACCESS_KEY_GROUP: readonly string[]` (= `['iam','v2','access-key']`), `CLI_MYSTERYBOX_PAYLOAD_GROUP: readonly string[]` (= `['mysterybox','payload']`).

- [ ] **Step 1: Add the dependency**

Run: `npm install @aws-sdk/client-s3@^3`
Expected: `package.json` gains `"@aws-sdk/client-s3"` under `dependencies`; `package-lock.json` updates; postinstall `patch-package` runs without error.

- [ ] **Step 2: Add storage constants**

Append to `src/core/constants.ts`:

```typescript
// ---------------------------------------------------------------------------
// Object Storage (S3) — data plane
// ---------------------------------------------------------------------------

/**
 * Default Nebius Object Storage S3 endpoint. // VERIFY: region host.
 * Mirrors the eu-north1 host used by the CLI install script.
 */
export const S3_ENDPOINT_DEFAULT = 'https://storage.eu-north1.nebius.cloud';

/** Default S3 region for Nebius Object Storage. // VERIFY. */
export const S3_REGION_DEFAULT = 'eu-north1';

/** `nebius iam v2 access-key ...` — CONFIRMED group (live CLI). */
export const CLI_ACCESS_KEY_GROUP = ['iam', 'v2', 'access-key'] as const;

/** `nebius mysterybox payload ...` — CONFIRMED group (live CLI). */
export const CLI_MYSTERYBOX_PAYLOAD_GROUP = ['mysterybox', 'payload'] as const;
```

- [ ] **Step 3: Write the constants smoke test**

Create `__tests__/storage/s3.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { S3_ENDPOINT_DEFAULT, S3_REGION_DEFAULT } from '../../src/core/constants';

describe('storage constants', () => {
  it('exposes Nebius S3 defaults', () => {
    expect(S3_ENDPOINT_DEFAULT).toMatch(/^https:\/\//);
    expect(S3_REGION_DEFAULT).not.toBe('');
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/storage/s3.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/core/constants.ts __tests__/storage/s3.test.ts
git commit -m "feat(storage): add aws-sdk dep and S3/CLI constants"
```

---

## Task 2: Ephemeral access-key minting (`storage/keys.ts`)

**Files:**
- Create: `src/core/storage/keys.ts`
- Test: `__tests__/storage/keys.test.ts`

**Interfaces:**
- Consumes: `runCli` (`src/core/cli/exec`), `firstString` (`src/core/json`), `mask` (`src/core/io/log`), constants from Task 1.
- Produces:
  - `interface EphemeralKeySpec { projectId: string; serviceAccountId: string; name?: string; expiresAt?: string; }`
  - `function buildMintKeyArgs(s: EphemeralKeySpec): string[]` (pure)
  - `interface MintedKey { accessKeyId: string; awsAccessKeyId: string; secretId: string; }`
  - `async function mintEphemeralKey(s: EphemeralKeySpec): Promise<MintedKey>`
  - `async function readAccessKeySecret(accessKeyId: string): Promise<string>` (returns the masked aws secret access key)

- [ ] **Step 1: Write failing tests**

Create `__tests__/storage/keys.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCli = vi.fn();
vi.mock('../../src/core/cli/exec', () => ({ runCli: (...a: unknown[]) => runCli(...a) }));
vi.mock('../../src/core/io/log', () => ({ mask: vi.fn(), log: { info: vi.fn() } }));

import {
  buildMintKeyArgs,
  mintEphemeralKey,
  readAccessKeySecret,
} from '../../src/core/storage/keys';

beforeEach(() => runCli.mockReset());

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
    expect(runCli).toHaveBeenCalledWith(expect.arrayContaining(['access-key', 'create']), { json: true });
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
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/storage/keys.test.ts`
Expected: FAIL ("Cannot find module '.../storage/keys'").

- [ ] **Step 3: Implement `storage/keys.ts`**

Create `src/core/storage/keys.ts`:

```typescript
/**
 * Ephemeral S3 access-key minting via `nebius iam v2 access-key`.
 *
 * Mints a short-lived access key FROM the already-configured service account,
 * with the secret delivered into MysteryBox (`--secret-delivery-mode mystery_box`)
 * so the job can mount the bucket via `…:ro:default@<secret-id>`. The runner
 * fetches the plaintext secret (for its own S3 upload) via `get-secret`.
 *
 * Arg-building is a pure function so it is unit-testable without the CLI.
 * CLI JSON field names are probed tolerantly (see `// VERIFY:` notes).
 */

import { runCli } from '../cli/exec';
import { mask } from '../io/log';
import { firstString } from '../json';
import { CLI_ACCESS_KEY_GROUP } from '../constants';

const GROUP = [...CLI_ACCESS_KEY_GROUP];

export interface EphemeralKeySpec {
  projectId: string;
  serviceAccountId: string;
  name?: string;
  /** RFC3339 timestamp; the key self-expires (cleanup mechanism). */
  expiresAt?: string;
}

export interface MintedKey {
  /** The access-key resource id (used to fetch the secret). */
  accessKeyId: string;
  /** The public AWS access key id (used for S3 SigV4). */
  awsAccessKeyId: string;
  /** The MysteryBox secret id the job mount references. */
  secretId: string;
}

/** Build `nebius iam v2 access-key create ...` args (pure). */
export function buildMintKeyArgs(s: EphemeralKeySpec): string[] {
  if (!s.projectId) throw new Error('EphemeralKeySpec.projectId is required.');
  if (!s.serviceAccountId) throw new Error('EphemeralKeySpec.serviceAccountId is required.');
  const args = [
    ...GROUP, 'create',
    '--parent-id', s.projectId,
    '--account-service-account-id', s.serviceAccountId,
    '--secret-delivery-mode', 'mystery_box',
  ];
  if (s.name) args.push('--name', s.name);
  if (s.expiresAt) args.push('--expires-at', s.expiresAt);
  return args;
}

/** Mint the ephemeral key and extract its ids (tolerant JSON probing). */
export async function mintEphemeralKey(s: EphemeralKeySpec): Promise<MintedKey> {
  const res = await runCli(buildMintKeyArgs(s), { json: true });
  const obj = (res.data ?? {}) as Record<string, unknown>;
  // VERIFY: exact field names from `iam v2 access-key create` JSON.
  const accessKeyId = firstString(obj, ['id', 'metadata.id', 'access_key_id', 'accessKeyId']);
  const awsAccessKeyId = firstString(obj, [
    'aws_access_key_id', 'status.aws_access_key_id', 'awsAccessKeyId', 'status.awsAccessKeyId',
  ]);
  const secretId = firstString(obj, [
    'status.secret_id', 'secret_id', 'status.secretId', 'status.mystery_box.secret_id',
  ]);
  if (!accessKeyId) throw new Error('access key id not found in create response.');
  if (!awsAccessKeyId) throw new Error('aws access key id not found in create response.');
  if (!secretId) throw new Error('MysteryBox secret id not found in create response.');
  return { accessKeyId, awsAccessKeyId, secretId };
}

/** Fetch and mask the plaintext AWS secret access key for a minted key. */
export async function readAccessKeySecret(accessKeyId: string): Promise<string> {
  if (!accessKeyId) throw new Error('readAccessKeySecret: accessKeyId is required.');
  const res = await runCli([...GROUP, 'get-secret', '--id', accessKeyId], {
    json: true,
    silent: true,
  });
  const obj = (res.data ?? {}) as Record<string, unknown>;
  // VERIFY: exact field name for the secret in `get-secret` JSON.
  const secret = firstString(obj, ['secret', 'aws_secret_access_key', 'awsSecretAccessKey', 'value']);
  if (!secret) throw new Error('aws secret access key not found in get-secret response.');
  mask(secret);
  return secret;
}
```

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run __tests__/storage/keys.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/storage/keys.ts __tests__/storage/keys.test.ts
git commit -m "feat(storage): mint ephemeral access key + read secret"
```

---

## Task 3: S3 PutObject wrapper (`storage/s3.ts`)

**Files:**
- Create: `src/core/storage/s3.ts`
- Test: `__tests__/storage/s3.test.ts` (extend the file from Task 1)

**Interfaces:**
- Consumes: `@aws-sdk/client-s3`, constants from Task 1.
- Produces:
  - `function objectUri(bucket: string, key: string): string` (pure) → `s3://bucket/key`
  - `interface S3Creds { accessKeyId: string; secretAccessKey: string; }`
  - `interface S3Target { endpoint: string; region: string; bucket: string; key: string; }`
  - `function buildS3ClientConfig(t: { endpoint: string; region: string }, c: S3Creds): S3ClientConfig` (pure)
  - `async function putObject(t: S3Target, c: S3Creds, body: Buffer | string): Promise<void>`

- [ ] **Step 1: Write failing tests (append to `__tests__/storage/s3.test.ts`)**

```typescript
import { objectUri, buildS3ClientConfig } from '../../src/core/storage/s3';

describe('objectUri', () => {
  it('joins bucket and key, trimming a leading slash on the key', () => {
    expect(objectUri('my-bucket', 'cfg/config.yaml')).toBe('s3://my-bucket/cfg/config.yaml');
    expect(objectUri('my-bucket', '/cfg/config.yaml')).toBe('s3://my-bucket/cfg/config.yaml');
  });
});

describe('buildS3ClientConfig', () => {
  it('sets endpoint, region, path-style and static creds', () => {
    const cfg = buildS3ClientConfig(
      { endpoint: 'https://storage.example', region: 'eu-north1' },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
    );
    expect(cfg.endpoint).toBe('https://storage.example');
    expect(cfg.region).toBe('eu-north1');
    expect(cfg.forcePathStyle).toBe(true);
    expect(cfg.credentials).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/storage/s3.test.ts`
Expected: FAIL ("Cannot find module '.../storage/s3'").

- [ ] **Step 3: Implement `storage/s3.ts`**

Create `src/core/storage/s3.ts`:

```typescript
/**
 * Minimal Object Storage upload over the S3 API.
 *
 * Nebius provides no JS object-storage SDK (control plane only), so we use
 * `@aws-sdk/client-s3` pointed at the Nebius S3 endpoint. `forcePathStyle` is on
 * for reliable addressing against a custom endpoint. Pure helpers
 * (`objectUri`, `buildS3ClientConfig`) are unit-tested; the network call is thin.
 */

import { S3Client, PutObjectCommand, type S3ClientConfig } from '@aws-sdk/client-s3';

export interface S3Creds {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3Target {
  endpoint: string;
  region: string;
  bucket: string;
  key: string;
}

/** `s3://bucket/key` (a leading slash on the key is trimmed). */
export function objectUri(bucket: string, key: string): string {
  return `s3://${bucket}/${key.replace(/^\/+/, '')}`;
}

/** Pure S3 client config builder (so it can be asserted without a network call). */
export function buildS3ClientConfig(
  t: { endpoint: string; region: string },
  c: S3Creds,
): S3ClientConfig {
  return {
    endpoint: t.endpoint,
    region: t.region,
    forcePathStyle: true,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  };
}

/** Upload a single object. Throws on S3 error (no silent failure). */
export async function putObject(t: S3Target, c: S3Creds, body: Buffer | string): Promise<void> {
  const client = new S3Client(buildS3ClientConfig(t, c));
  try {
    await client.send(
      new PutObjectCommand({ Bucket: t.bucket, Key: t.key.replace(/^\/+/, ''), Body: body }),
    );
  } finally {
    client.destroy();
  }
}
```

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run __tests__/storage/s3.test.ts`
Expected: PASS (constants + objectUri + buildS3ClientConfig).

- [ ] **Step 5: Commit**

```bash
git add src/core/storage/s3.ts __tests__/storage/s3.test.ts
git commit -m "feat(storage): S3 PutObject wrapper over aws-sdk"
```

---

## Task 4: Upload orchestration + input adapter + barrel (`storage/upload.ts`, `storage/index.ts`)

**Files:**
- Create: `src/core/storage/upload.ts`
- Create: `src/core/storage/index.ts`
- Modify: `src/core/index.ts`
- Test: `__tests__/storage/upload.test.ts`

**Interfaces:**
- Consumes: `mintEphemeralKey`, `readAccessKeySecret` (keys.ts); `putObject`, `objectUri` (s3.ts); `getString`, `parseDurationMs` (core); `readFileSync` (node).
- Produces:
  - `interface UploadSpec { source: string; bucket: string; key: string; serviceAccountId: string; projectId: string; expiresIn?: string; endpoint: string; region: string; }`
  - `interface UploadResult { objectUri: string; secretId: string; }`
  - `function buildUploadSpecFromInputs(): UploadSpec`
  - `async function uploadObject(spec: UploadSpec): Promise<UploadResult>`
  - barrel re-exports everything in `keys.ts`, `s3.ts`, `upload.ts`.

- [ ] **Step 1: Write failing tests**

Create `__tests__/storage/upload.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mintEphemeralKey = vi.fn();
const readAccessKeySecret = vi.fn();
const putObject = vi.fn();
vi.mock('../../src/core/storage/keys', () => ({
  mintEphemeralKey: (...a: unknown[]) => mintEphemeralKey(...a),
  readAccessKeySecret: (...a: unknown[]) => readAccessKeySecret(...a),
}));
vi.mock('../../src/core/storage/s3', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/storage/s3')>(
    '../../src/core/storage/s3',
  );
  return { ...actual, putObject: (...a: unknown[]) => putObject(...a) };
});
vi.mock('node:fs', () => ({ readFileSync: () => Buffer.from('config: yaml\n') }));

import { uploadObject } from '../../src/core/storage/upload';

beforeEach(() => {
  mintEphemeralKey.mockReset();
  readAccessKeySecret.mockReset();
  putObject.mockReset();
});

describe('uploadObject', () => {
  it('mints a key, uploads, and returns uri + secret id', async () => {
    mintEphemeralKey.mockResolvedValueOnce({ accessKeyId: 'ak', awsAccessKeyId: 'AK', secretId: 'mbx-1' });
    readAccessKeySecret.mockResolvedValueOnce('SK');
    putObject.mockResolvedValueOnce(undefined);

    const res = await uploadObject({
      source: '/tmp/config.yaml', bucket: 'b', key: 'cfg/config.yaml',
      serviceAccountId: 'sa', projectId: 'proj',
      endpoint: 'https://s3.example', region: 'eu-north1',
    });

    expect(res).toEqual({ objectUri: 's3://b/cfg/config.yaml', secretId: 'mbx-1' });
    expect(putObject).toHaveBeenCalledWith(
      { endpoint: 'https://s3.example', region: 'eu-north1', bucket: 'b', key: 'cfg/config.yaml' },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/storage/upload.test.ts`
Expected: FAIL ("Cannot find module '.../storage/upload'").

- [ ] **Step 3: Implement `storage/upload.ts`**

Create `src/core/storage/upload.ts`:

```typescript
/**
 * Orchestrates a single-file upload to Nebius Object Storage:
 *   mint ephemeral key (secret -> MysteryBox) -> read plaintext secret ->
 *   S3 PutObject -> return { objectUri, secretId } for the job mount.
 */

import { readFileSync } from 'node:fs';
import { getString } from '../io/inputs';
import { parseDurationMs } from '../time';
import { S3_ENDPOINT_DEFAULT, S3_REGION_DEFAULT } from '../constants';
import { mintEphemeralKey, readAccessKeySecret } from './keys';
import { putObject, objectUri } from './s3';

export interface UploadSpec {
  source: string;
  bucket: string;
  key: string;
  serviceAccountId: string;
  projectId: string;
  expiresIn?: string;
  endpoint: string;
  region: string;
}

export interface UploadResult {
  objectUri: string;
  secretId: string;
}

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2h

/** Read action inputs into an UploadSpec. */
export function buildUploadSpecFromInputs(): UploadSpec {
  const expiresIn = getString('expires-in', { default: '2h' });
  return {
    source: getString('source', { required: true }),
    bucket: getString('bucket', { required: true }),
    key: getString('key', { required: true }),
    serviceAccountId: getString('service-account-id', { required: true }),
    projectId: getString('project-id', { required: true }),
    expiresIn,
    endpoint: getString('endpoint', { default: S3_ENDPOINT_DEFAULT }),
    region: getString('region', { default: S3_REGION_DEFAULT }),
  };
}

/** Run the mint -> upload flow. */
export async function uploadObject(
  spec: UploadSpec,
  now: () => number = Date.now,
): Promise<UploadResult> {
  const ttlMs = parseDurationMs(spec.expiresIn) ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(now() + ttlMs).toISOString();

  const minted = await mintEphemeralKey({
    projectId: spec.projectId,
    serviceAccountId: spec.serviceAccountId,
    name: `upload-${spec.bucket}`,
    expiresAt,
  });
  const secretAccessKey = await readAccessKeySecret(minted.accessKeyId);

  const body = readFileSync(spec.source);
  await putObject(
    { endpoint: spec.endpoint, region: spec.region, bucket: spec.bucket, key: spec.key },
    { accessKeyId: minted.awsAccessKeyId, secretAccessKey },
    body,
  );

  return { objectUri: objectUri(spec.bucket, spec.key), secretId: minted.secretId };
}
```

- [ ] **Step 4: Implement the barrel + wire into core**

Create `src/core/storage/index.ts`:

```typescript
/** Public surface of the `storage` module. */
export * from './keys';
export * from './s3';
export * from './upload';
```

Add to `src/core/index.ts` (after the `./jobs` line):

```typescript
export * from './storage';
```

- [ ] **Step 5: Run tests + commit**

Run: `npx vitest run __tests__/storage/`
Expected: PASS (all storage tests).

```bash
git add src/core/storage/ src/core/index.ts __tests__/storage/upload.test.ts
git commit -m "feat(storage): uploadObject orchestration + barrel"
```

---

## Task 5: `upload-object` entrypoint + action.yml + build

**Files:**
- Create: `src/entrypoints/upload-object.ts`
- Create: `actions/upload-object/action.yml`
- Generated: `actions/upload-object/dist/` (via `npm run build`)

**Interfaces:**
- Consumes: `buildUploadSpecFromInputs`, `uploadObject`, `ensureCli`, `setOutput`, `fail`, `log` (all from `../core`).
- Produces: the `upload-object` action with outputs `object-uri`, `secret-id`.

- [ ] **Step 1: Implement the entrypoint**

Create `src/entrypoints/upload-object.ts`:

```typescript
/**
 * `upload-object` action entrypoint.
 *
 * Uploads a local file to a pre-existing Nebius Object Storage bucket using a
 * short-lived access key minted from the configured service account, and
 * outputs the object URI plus the MysteryBox secret id for a job's S3 mount.
 */

import {
  buildUploadSpecFromInputs,
  uploadObject,
  ensureCli,
  fail,
  log,
  setOutput,
} from '../core';

async function run(): Promise<void> {
  await ensureCli({ version: 'latest' });
  const spec = buildUploadSpecFromInputs();

  const result = await log.group('Upload object', async () => {
    const r = await uploadObject(spec);
    log.info(`Uploaded ${r.objectUri} (mount secret: ${r.secretId}).`);
    return r;
  });

  setOutput('object-uri', result.objectUri);
  setOutput('secret-id', result.secretId);
}

run().catch((err) => fail(err));
```

- [ ] **Step 2: Create `actions/upload-object/action.yml`**

```yaml
name: 'Nebius Upload Object'
description: >-
  Upload a local file to a pre-existing Nebius Object Storage bucket using a
  short-lived access key minted from the configured service account. Outputs the
  object URI and a MysteryBox secret id for mounting the bucket in a Job.
author: 'Nebius Actions'
branding:
  icon: 'upload-cloud'
  color: 'blue'

inputs:
  source:
    description: 'Local file path on the runner to upload (required).'
    required: true
  bucket:
    description: 'Target bucket name (must already exist) (required).'
    required: true
  key:
    description: 'Object key (or prefix/path) within the bucket (required).'
    required: true
  service-account-id:
    description: 'Service account to mint the ephemeral access key for (required).'
    required: true
  project-id:
    description: 'Parent project for the access key + MysteryBox secret (required).'
    required: true
  expires-in:
    description: 'Ephemeral key TTL (e.g. 2h, 30m).'
    required: false
    default: '2h'
  endpoint:
    description: 'S3 endpoint for Nebius Object Storage.'
    required: false
    default: 'https://storage.eu-north1.nebius.cloud'
  region:
    description: 'S3 region.'
    required: false
    default: 'eu-north1'

outputs:
  object-uri:
    description: 'The uploaded object URI (s3://bucket/key).'
  secret-id:
    description: 'MysteryBox secret id for the job mount (…:ro:default@<secret-id>).'

runs:
  using: 'node24'
  main: 'dist/index.js'
```

- [ ] **Step 3: Build the dist bundle**

Run: `npm run build`
Expected: `scripts/build.mjs` discovers `upload-object` and writes `actions/upload-object/dist/index.js` (and `licenses.txt`). No errors.

- [ ] **Step 4: Verify typecheck + full test suite**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/upload-object.ts actions/upload-object/
git commit -m "feat(upload-object): add action entrypoint, metadata, and dist"
```

---

## Task 6: Wire the workflow (inline config + upload + mount)

**Files:**
- Modify: `.github/workflows/demo-run-job.yml`
- Delete: `examples/axolotl/config.yaml`

**Interfaces:**
- Consumes: the `upload-object` action (`object-uri`, `secret-id` outputs); `submit-job` `mounts` input.
- Produces: a working demo whose job reads its config from a mounted bucket.

- [ ] **Step 1: Replace the header comment block**

Replace lines 12–16 (the "No bucket needed…" paragraph) of `.github/workflows/demo-run-job.yml` with:

```yaml
# The Axolotl config is inlined in this workflow, uploaded to a pre-existing
# Object Storage bucket (vars.NEBIUS_CONFIG_BUCKET) by the `upload-object`
# action, and mounted read-only into the job at /workspace/cfg. The upload mints
# a short-lived S3 access key from the service account (secret delivered to
# MysteryBox) so no new GitHub secret is needed; the job mounts via
# `…:ro:default@<secret-id>`. Adapters still write to ephemeral /tmp/output.
```

- [ ] **Step 2: Add the bucket var to the `Requires:` list**

Add under the `Requires:` block (after the `vars.NEBIUS_PROJECT_ID` line):

```yaml
#   vars.NEBIUS_CONFIG_BUCKET       - pre-existing Object Storage bucket for the config
```

- [ ] **Step 3: Replace the "Encode Axolotl config" step with an inline-write step**

Replace the step at lines 55–59 with:

```yaml
      # Write the Axolotl config inline so this workflow is the single source of
      # truth, then hand the file to upload-object.
      - name: Write Axolotl config
        id: cfg
        run: |
          mkdir -p "$RUNNER_TEMP"
          cat > "$RUNNER_TEMP/config.yaml" <<'YAML'
          base_model: Qwen/Qwen2.5-0.5B

          load_in_4bit: true
          adapter: qlora

          datasets:
            - path: Salesforce/wikitext
              name: wikitext-2-raw-v1
              split: "train[:2000]"
              type: completion
              field: text

          sequence_len: 128
          micro_batch_size: 1
          gradient_accumulation_steps: 1

          learning_rate: 2e-4
          max_steps: 30
          val_set_size: 0
          logging_steps: 5

          dataset_prepared_path: /workspace/output/last_run_prepared
          output_dir: /tmp/output

          lora_r: 8
          lora_alpha: 16
          lora_dropout: 0.05
          lora_target_modules:
            - q_proj
            - k_proj
            - v_proj
            - o_proj
            - gate_proj
            - up_proj
            - down_proj
          YAML
```

- [ ] **Step 4: Add the upload step after `Set up Nebius`**

Insert after the `Set up Nebius` step (after current line 71):

```yaml
      # Upload the config to the bucket. Mints a short-lived S3 key from the SA
      # (secret -> MysteryBox) and returns the object URI + mount secret id.
      - name: Upload Axolotl config
        id: upload
        uses: ./actions/upload-object
        with:
          source: ${{ runner.temp }}/config.yaml
          bucket: ${{ vars.NEBIUS_CONFIG_BUCKET }}
          key: ${{ github.run_id }}/config.yaml
          service-account-id: ${{ vars.NEBIUS_SERVICE_ACCOUNT_ID }}
          project-id: ${{ vars.NEBIUS_PROJECT_ID }}
```

- [ ] **Step 5: Mount the bucket and read the config from it**

In the `Submit Axolotl fine-tune` step, add a `mounts:` input (after `project-id:`):

```yaml
          mounts: ${{ vars.NEBIUS_CONFIG_BUCKET }}:/workspace/cfg:ro:default@${{ steps.upload.outputs.secret-id }}
```

Then replace the final `--args` line of `extra-args` (the base64-decode pipeline) with:

```yaml
            --args
            -c "axolotl train /workspace/cfg/config.yaml"
```

- [ ] **Step 6: Delete the now-inlined example file**

Run: `git rm examples/axolotl/config.yaml`
Expected: file staged for deletion. (If `examples/axolotl/` is now empty, leave it — git ignores empty dirs.)

- [ ] **Step 7: Validate workflow YAML**

Run: `npx --yes js-yaml .github/workflows/demo-run-job.yml > /dev/null && echo OK`
Expected: `OK` (valid YAML). If `js-yaml` is unavailable, instead run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/demo-run-job.yml')); print('OK')"`.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/demo-run-job.yml examples/axolotl/config.yaml
git commit -m "demo(run-job): inline config, upload to bucket, mount in job"
```

---

## Task 7: README + final validation

**Files:**
- Modify: `README.md` (actions table)

**Interfaces:**
- Consumes: nothing.
- Produces: documented `upload-object` action; green `npm run all`.

- [ ] **Step 1: Add the actions-table row**

Insert into the `## Actions` table in `README.md`, after the `submit-job` row (line 123):

```markdown
| **`upload-object`**     | Upload a local file to a pre-existing bucket via a short-lived SA-minted S3 key; output the object URI + MysteryBox mount secret. | `source` _(required)_, `bucket` _(required)_, `key` _(required)_, `service-account-id` _(required)_, `project-id` _(required)_, `expires-in` (`2h`), `endpoint`, `region` | `object-uri`, `secret-id`       |
```

- [ ] **Step 2: Run the full pipeline**

Run: `npm run all`
Expected: lint, typecheck, all vitest tests, and build all PASS. (If a dist-drift check exists in CI, the committed `actions/upload-object/dist/` matches a fresh build.)

- [ ] **Step 3: Manual CLI-shape verification note**

Confirm (against a real project, when credentials are available) the `// VERIFY:` field paths in `storage/keys.ts`:

```bash
nebius iam v2 access-key create --parent-id <PROJECT> \
  --account-service-account-id <SA> --secret-delivery-mode mystery_box \
  --expires-at 2026-12-31T00:00:00Z --format json
# Confirm the JSON keys for: access-key id, aws_access_key_id, MysteryBox secret_id.
nebius iam v2 access-key get-secret --id <ACCESS_KEY_ID> --format json
# Confirm the JSON key for the plaintext secret.
```

If any field name differs, update the corresponding `firstString([...])` probe list in `src/core/storage/keys.ts`, rebuild (`npm run build`), and re-commit. (No code-path change — only the candidate list.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the upload-object action"
```

---

## Self-review notes

- **Spec coverage:** inline config (Task 6 §3), new upload action (Tasks 2–5), bucket mount (Task 6 §5), ephemeral-key-from-SA + MysteryBox (Task 2 + Task 4), `@aws-sdk/client-s3` (Task 1/3), pre-existing bucket assumption (action.yml wording + Task 6), tests (every core task), README (Task 7). Output persistence intentionally left at `/tmp/output` per the spec's out-of-scope list.
- **Plaintext path decision:** the plan uses `--secret-delivery-mode mystery_box` (so Nebius creates the mount-compatible secret) + `get-secret` for the runner's plaintext — the spec's preferred path. The inline+hand-crafted-MysteryBox fallback is unnecessary unless `get-secret` does not return plaintext for a MysteryBox-delivered key, which Task 7 §3 verifies.
- **Type consistency:** `MintedKey { accessKeyId, awsAccessKeyId, secretId }` is produced in Task 2 and consumed unchanged in Task 4; `S3Target`/`S3Creds` shapes match between Task 3 and the Task 4 `putObject` call and its test.
```
