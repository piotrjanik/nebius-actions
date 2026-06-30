/**
 * Empty a bucket by deleting every object (S3 data plane). Used by delete-bucket
 * before the CLI delete, so the delete works regardless of whether the CLI
 * refuses non-empty buckets.
 */

import { getString } from '../io/inputs';
import { parseDurationMs } from '../time';
import { S3_ENDPOINT_DEFAULT, S3_REGION_DEFAULT } from '../constants';
import { mintEphemeralKey, readAccessKeySecret } from './keys';
import { listObjects, deleteObjects } from './s3';

export interface EmptySpec {
  bucket: string;
  serviceAccountId: string;
  projectId: string;
  expiresIn?: string;
  endpoint: string;
  region: string;
}

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2h

export function buildEmptySpecFromInputs(): EmptySpec {
  return {
    bucket: getString('bucket', { required: true }),
    serviceAccountId: getString('service-account-id', { required: true }),
    projectId: getString('project-id', { required: true }),
    expiresIn: getString('expires-in', { default: '2h' }),
    endpoint: getString('endpoint', { default: S3_ENDPOINT_DEFAULT }),
    region: getString('region', { default: S3_REGION_DEFAULT }),
  };
}

/** Mint a key, list all objects, delete them; return how many were deleted. */
export async function emptyBucket(spec: EmptySpec, now: () => number = Date.now): Promise<number> {
  const ttlMs = parseDurationMs(spec.expiresIn) ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(now() + ttlMs).toISOString();
  const minted = await mintEphemeralKey({
    projectId: spec.projectId,
    serviceAccountId: spec.serviceAccountId,
    name: `empty-${spec.bucket}`,
    expiresAt,
  });
  const secretAccessKey = await readAccessKeySecret(minted.accessKeyId);
  const loc = { endpoint: spec.endpoint, region: spec.region, bucket: spec.bucket };
  const creds = { accessKeyId: minted.awsAccessKeyId, secretAccessKey };
  const keys = await listObjects(loc, creds, '');
  await deleteObjects(loc, creds, keys);
  return keys.length;
}
