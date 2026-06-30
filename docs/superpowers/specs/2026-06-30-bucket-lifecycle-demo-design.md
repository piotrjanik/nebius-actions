# Bucket lifecycle in the demo — design

Date: 2026-06-30
Status: approved (design); pending implementation plan

## Problem

The `demo-run-job` workflow currently depends on a **pre-existing** bucket
(`vars.NEBIUS_CONFIG_BUCKET`): it uploads the Axolotl config there and mounts it
read-only, but training output goes to ephemeral container disk and nothing is
verified afterward. We want the demo to own the full bucket lifecycle and prove
the model was actually produced:

1. **Create** a fresh, run-scoped bucket.
2. **Upload** the inlined Axolotl config to it.
3. **Run** the fine-tune, writing adapters **into** the bucket.
4. **Verify** the model was trained (artifacts exist in the bucket).
5. **Delete** the bucket on cleanup — always, even on failure/cancellation.

## Decisions

- **Two control actions, not one:** `create-bucket` and `delete-bucket`, matching
  the repo's verb-per-action convention (`submit-job`/`cancel-job`,
  `deploy-endpoint`/`delete-endpoint`).
- **Verify = persist + runner-side check:** the job writes its output into the
  bucket (read-write mount); a new `check-object` action asserts the artifacts
  exist from the runner.
- **`check-object` verifies by prefix,** not a guessed filename: it lists objects
  under a prefix and fails if the count is 0 (robust to Axolotl's exact output
  naming).
- **`delete-bucket` empties first, then deletes:** it cannot be assumed that
  `nebius storage bucket delete --ttl 0s` deletes a non-empty bucket, so
  `delete-bucket` empties via S3 (`ListObjectsV2` → `DeleteObjects`) and then runs
  the CLI delete — bulletproof regardless of CLI behavior.

## Key constraints (verified against the live `nebius` CLI)

- `nebius storage bucket create --name <n> --parent-id <project>` (control plane;
  uses the SA key already configured by `setup`). `--parent-id` is required.
- `nebius storage bucket delete --id <id> [--ttl <dur>|--purge-at <ts>]`. The
  bucket group help states: to delete an Active bucket instantly, use Delete with
  zero ttl (`--ttl 0s`). Whether that cascades over a non-empty bucket is
  unverified → `delete-bucket` empties first.
- Object data plane (upload, list, delete objects) requires AWS-style
  access-key + secret over the S3 API — same ephemeral-key mint already used by
  `upload-object` (`nebius iam v2 access-key create … --secret-delivery-mode
  mystery_box`). The SA key cannot do S3 data-plane operations.
- Bucket names must be DNS-compatible and unique. The workflow uses
  `demo-axolotl-${{ github.run_id }}` (lowercase + digits + hyphen).

## End-to-end flow (workflow)

```
checkout
  → Write Axolotl config (inline → $RUNNER_TEMP/config.yaml)
  → Set up Nebius (CLI + key profile)
  → create-bucket  (name: demo-axolotl-<run_id>)         → bucket-name, bucket-id
  → upload-object  (bucket: <bucket-name>, key: config.yaml) → secret-id
  → submit-job     (rw mount s3://<bucket-name>:/workspace/data:rw:default@<secret-id>,
                    args: axolotl train /workspace/data/config.yaml)  → job-id
  → wait-for-job   (poll to terminal, stream logs)        → status, exit-code
  → check-object   (bucket: <bucket-name>, prefix: output/) → object-count   # verify gate
  → [if: always() && bucket-id != ''] delete-bucket (bucket-id: <bucket-id>)  # cleanup
  → [if: cancelled()] cancel-job
  → Report result
```

## New actions

### `create-bucket` (control plane; no aws-sdk)

- Files: `src/entrypoints/create-bucket.ts`, `src/core/storage/bucket.ts`,
  `actions/create-bucket/action.yml` + dist.
- Entrypoint imports bucket functions from `../core/storage/bucket` **directly**
  (NOT the `../core/storage` barrel, which transitively imports `s3.ts` →
  `@aws-sdk/client-s3`). This keeps the create-bucket bundle aws-sdk-free.
- `bucket.ts` (mirrors `jobs/jobs.ts`):
  - `interface CreateBucketSpec { name: string; projectId: string; maxSizeBytes?: string }`
  - `buildCreateBucketArgs(s): string[]` (pure) → `['storage','bucket','create','--name',name,'--parent-id',projectId, …]`
  - `interface BucketRef { id: string; name: string }`
  - `createBucket(s): Promise<BucketRef>` — runs the CLI with `{ json: true }`,
    probes id/name via `firstString` (`// VERIFY:` field names).
  - `buildDeleteBucketArgs(id, ttl='0s'): string[]` → `['storage','bucket','delete','--id',id,'--ttl',ttl]`
  - `deleteBucket(id): Promise<void>`
- `action.yml` inputs: `name` _(required)_, `project-id` _(required)_,
  `max-size-bytes` (optional). Outputs: `bucket-name`, `bucket-id`.

### `check-object` (data plane; aws-sdk)

- Files: `src/entrypoints/check-object.ts`, `src/core/storage/check.ts`,
  S3 helpers in `s3.ts`, `actions/check-object/action.yml` + dist.
- `s3.ts` introduces a location type `S3Location { endpoint; region; bucket }`
  and redefines `S3Target = S3Location & { key }` (so `putObject` is unchanged).
  It gains `listObjects(loc: S3Location, c: S3Creds, prefix: string): Promise<string[]>`
  (paginated `ListObjectsV2`, returns keys).
- `check.ts`: `checkObject(spec): Promise<number>` — mint ephemeral key (reuse
  `mintEphemeralKey` + `readAccessKeySecret`) → `listObjects(prefix)` →
  return count; the entrypoint **throws if count === 0** (verification fails).
- `action.yml` inputs: `bucket` _(required)_, `prefix` _(required)_,
  `service-account-id` _(required)_, `project-id` _(required)_, `expires-in`
  (`2h`), `endpoint`, `region`. Outputs: `object-count`.

### `delete-bucket` (control + data plane; aws-sdk)

- Files: `src/entrypoints/delete-bucket.ts`, `src/core/storage/empty.ts`,
  S3 helper `deleteObjects` in `s3.ts`, `actions/delete-bucket/action.yml` + dist.
- `s3.ts` gains `deleteObjects(loc: S3Location, c: S3Creds, keys: string[]): Promise<void>`
  (`DeleteObjects`, batched ≤1000 per request).
- `empty.ts`: `emptyBucket(spec): Promise<number>` — mint key → `listObjects('')`
  → `deleteObjects(keys)` → return deleted count (no-op when already empty).
- Entrypoint: `emptyBucket(...)` then `deleteBucket(bucketId)` (from `bucket.ts`).
- `action.yml` inputs: `bucket` _(required, the name, for S3 emptying)_,
  `bucket-id` _(required, for the CLI delete)_, `service-account-id` _(required)_,
  `project-id` _(required)_, `expires-in`/`endpoint`/`region`. Outputs:
  `deleted-count`.

## Workflow changes (`.github/workflows/demo-run-job.yml`)

- Remove `vars.NEBIUS_CONFIG_BUCKET` from the `Requires:` block and header; the
  bucket is now created per run.
- Inlined config: `output_dir: /workspace/data/output` (was `/tmp/output`);
  `dataset_prepared_path` stays local (`/tmp/output/last_run_prepared`).
- New `create-bucket` step (id `bucket`) after `setup`:
  `name: demo-axolotl-${{ github.run_id }}`, `project-id`.
- `upload-object` step: `bucket: ${{ steps.bucket.outputs.bucket-name }}`,
  `key: config.yaml` (run_id prefix dropped — the bucket is already per-run).
- `submit-job`: mount becomes **rw** —
  `mounts: s3://${{ steps.bucket.outputs.bucket-name }}:/workspace/data:rw:default@${{ steps.upload.outputs.secret-id }}`;
  container args `-c "axolotl train /workspace/data/config.yaml"`.
- New `check-object` step after `wait-for-job`:
  `bucket: ${{ steps.bucket.outputs.bucket-name }}`, `prefix: output/`,
  `service-account-id`, `project-id`. (Runs only on success — default GH behavior.)
- New `delete-bucket` cleanup step:
  `if: always() && steps.bucket.outputs.bucket-id != ''`, with `bucket`,
  `bucket-id`, `service-account-id`, `project-id`.

## Code structure & bundling

- Reuse: `mintEphemeralKey`/`readAccessKeySecret` (keys.ts), `S3Client` config
  builder + `objectUri` (s3.ts), `runCli`/`firstString`/`mask`/`getString`.
- Bundling isolation (learned previously): the `src/core` barrel must NOT
  re-export `storage`. Each entrypoint imports the minimum subpath so only
  `check-object`/`delete-bucket`/`upload-object` carry aws-sdk; `create-bucket`
  stays lean by importing `../core/storage/bucket` directly.
- New constants in `constants.ts`: `CLI_STORAGE_BUCKET_GROUP = ['storage','bucket']`.

## Testing

- Vitest unit tests for every pure arg-builder (`buildCreateBucketArgs`,
  `buildDeleteBucketArgs`) and orchestration (`createBucket`, `emptyBucket`,
  `checkObject`) with mocked `runCli` and mocked S3 helpers — no live network.
- `s3.ts` `listObjects`/`deleteObjects`: test the pure request-shaping
  (pagination token threading, batch chunking) with a mocked S3 client `send`.
- `npm run all` (lint + typecheck + test + build) green; committed dist for the
  three new actions; aws-sdk confined to `check-object`/`delete-bucket`/`upload-object`
  (assert 0 S3 refs in `create-bucket` and the unrelated actions' bundles).

## Out of scope (YAGNI)

- Bucket versioning, lifecycle policies, CORS, ACLs.
- Downloading/inspecting the trained adapter contents (existence is enough).
- Reusing one minted key across upload/check/empty (each action mints its own
  short-lived key; simpler and stateless).

## Open items to verify during implementation (defensive, not blocking)

- Exact JSON field names from `storage bucket create` (`// VERIFY:` probes).
- Whether `bucket delete --ttl 0s` cascades over a non-empty bucket (the
  empty-first step makes this moot; drop it only if confirmed unnecessary).
- That an rw S3 mount supports Axolotl's output writes (adapters are small;
  dataset cache stays on local disk).
