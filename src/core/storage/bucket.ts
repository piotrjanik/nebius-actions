/**
 * Bucket control-plane wrappers over the `@nebius/js-sdk` `BucketService` gRPC
 * API (`nebius.storage.v1`).
 *
 * Control plane only (create/delete the bucket resource) — NO object data and
 * NO aws-sdk. Importing this file must not pull in `s3.ts`, so the create-bucket
 * action stays free of @aws-sdk/client-s3. The I/O functions take an injected
 * `BucketServiceLike` (mirroring endpoints/jobs) so they are unit-testable with
 * a tiny fake; the request builders are pure and exported for direct testing.
 */

import {
  CreateBucketRequest,
  DeleteBucketRequest,
} from '@nebius/js-sdk/api/nebius/storage/v1/index';
import { dayjs } from '@nebius/js-sdk/runtime/protos/index';
import { parseDurationMs } from '../time';

export interface CreateBucketSpec {
  name: string;
  projectId: string;
  maxSizeBytes?: string;
}

export interface BucketRef {
  id: string;
  name: string;
}

/** Minimal Operation surface used here (satisfied by the SDK's Operation). */
export interface OperationLike {
  resourceId(): string;
  raw?(): unknown;
}

/** Minimal Bucket service surface (satisfied by the SDK's `BucketService`). */
export interface BucketServiceLike {
  create(req: CreateBucketRequest): { result: Promise<OperationLike> };
  delete(req: DeleteBucketRequest): { result: Promise<OperationLike> };
}

/** Build the SDK `CreateBucketRequest` (pure). */
export function buildCreateBucketRequest(s: CreateBucketSpec): CreateBucketRequest {
  if (!s.name) throw new Error('CreateBucketSpec.name is required.');
  if (!s.projectId) throw new Error('CreateBucketSpec.projectId is required.');
  let maxSizeBytes: number | undefined;
  if (s.maxSizeBytes) {
    maxSizeBytes = Number(s.maxSizeBytes);
    if (!Number.isFinite(maxSizeBytes) || maxSizeBytes < 0) {
      throw new Error(`CreateBucketSpec.maxSizeBytes is not a byte count: '${s.maxSizeBytes}'.`);
    }
  }
  return CreateBucketRequest.create({
    metadata: { name: s.name, parentId: s.projectId },
    ...(maxSizeBytes !== undefined ? { spec: { maxSizeBytes } } : {}),
  });
}

/** Create a bucket; returns its id (from the Operation) and name. */
export async function createBucket(
  service: BucketServiceLike,
  s: CreateBucketSpec,
): Promise<BucketRef> {
  const op = await service.create(buildCreateBucketRequest(s)).result;
  const id = op.resourceId();
  if (!id) throw new Error('bucket id not found in create operation.');
  return { id, name: s.name };
}

/**
 * Build the SDK `DeleteBucketRequest` (pure). The purge `ttl` is how long the
 * deleted bucket stays restorable; zero purges immediately (the API default
 * would otherwise keep it for 7 days).
 */
export function buildDeleteBucketRequest(id: string, ttl = '0s'): DeleteBucketRequest {
  if (!id) throw new Error('buildDeleteBucketRequest: id is required.');
  const ttlMs = parseDurationMs(ttl);
  if (ttlMs === undefined) {
    throw new Error(`buildDeleteBucketRequest: unparseable ttl '${ttl}'.`);
  }
  return DeleteBucketRequest.create({
    id,
    purge: { $case: 'ttl', ttl: dayjs.duration(ttlMs) },
  });
}

/** Delete a bucket (instant purge by default). */
export async function deleteBucket(
  service: BucketServiceLike,
  id: string,
  ttl = '0s',
): Promise<void> {
  await service.delete(buildDeleteBucketRequest(id, ttl)).result;
}
