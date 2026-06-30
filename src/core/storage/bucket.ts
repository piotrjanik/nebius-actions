/**
 * Bucket control-plane wrappers over the `nebius storage bucket` CLI group.
 *
 * Control plane only (create/delete the bucket resource) — NO object data and
 * NO aws-sdk. Importing this file must not pull in `s3.ts`, so the create-bucket
 * action stays free of @aws-sdk/client-s3. Pure arg-builders mirror jobs.ts.
 */

import { runCli } from '../cli/exec';
import { firstString } from '../json';
import { CLI_STORAGE_BUCKET_GROUP } from '../constants';

const GROUP = [...CLI_STORAGE_BUCKET_GROUP];

export interface CreateBucketSpec {
  name: string;
  projectId: string;
  maxSizeBytes?: string;
}

export interface BucketRef {
  id: string;
  name: string;
}

/** Build `nebius storage bucket create ...` args (pure). */
export function buildCreateBucketArgs(s: CreateBucketSpec): string[] {
  if (!s.name) throw new Error('CreateBucketSpec.name is required.');
  if (!s.projectId) throw new Error('CreateBucketSpec.projectId is required.');
  const args = [...GROUP, 'create', '--name', s.name, '--parent-id', s.projectId];
  if (s.maxSizeBytes) args.push('--max-size-bytes', s.maxSizeBytes);
  return args;
}

/** Create a bucket; return its id and name (tolerant JSON probing). */
export async function createBucket(s: CreateBucketSpec): Promise<BucketRef> {
  const res = await runCli(buildCreateBucketArgs(s), { json: true });
  const obj = (res.data ?? {}) as Record<string, unknown>;
  // VERIFY: exact field names from `storage bucket create` JSON.
  const id = firstString(obj, ['id', 'metadata.id', 'bucket_id', 'bucketId']);
  const name = firstString(obj, ['name', 'metadata.name', 'spec.name']) ?? s.name;
  if (!id) throw new Error('bucket id not found in create response.');
  return { id, name };
}

/** Build `nebius storage bucket delete ...` args (pure). Zero ttl = instant. */
export function buildDeleteBucketArgs(id: string, ttl = '0s'): string[] {
  if (!id) throw new Error('buildDeleteBucketArgs: id is required.');
  return [...GROUP, 'delete', '--id', id, '--ttl', ttl];
}

/** Delete a bucket (instant by default). */
export async function deleteBucket(id: string, ttl = '0s'): Promise<void> {
  await runCli(buildDeleteBucketArgs(id, ttl), { json: true });
}
