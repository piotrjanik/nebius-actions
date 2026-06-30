/**
 * Verify that objects exist under a bucket prefix (the "model trained" gate).
 * Mints a short-lived S3 key (same mechanism as upload), lists the prefix, and
 * returns the count. The entrypoint fails the action when the count is 0.
 */

import { getString } from '../io/inputs';
import { parseDurationMs } from '../time';
import { S3_ENDPOINT_DEFAULT, S3_REGION_DEFAULT } from '../constants';
import { mintEphemeralKey, readAccessKeySecret } from './keys';
import { listObjects } from './s3';

export interface CheckSpec {
  bucket: string;
  prefix: string;
  serviceAccountId: string;
  projectId: string;
  expiresIn?: string;
  endpoint: string;
  region: string;
}

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2h

export function buildCheckSpecFromInputs(): CheckSpec {
  return {
    bucket: getString('bucket', { required: true }),
    prefix: getString('prefix', { required: true }),
    serviceAccountId: getString('service-account-id', { required: true }),
    projectId: getString('project-id', { required: true }),
    expiresIn: getString('expires-in', { default: '2h' }),
    endpoint: getString('endpoint', { default: S3_ENDPOINT_DEFAULT }),
    region: getString('region', { default: S3_REGION_DEFAULT }),
  };
}

/** Mint a key, list `prefix`, and return how many objects exist. */
export async function checkObject(spec: CheckSpec, now: () => number = Date.now): Promise<number> {
  const ttlMs = parseDurationMs(spec.expiresIn) ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(now() + ttlMs).toISOString();
  const minted = await mintEphemeralKey({
    projectId: spec.projectId,
    serviceAccountId: spec.serviceAccountId,
    name: `check-${spec.bucket}`,
    expiresAt,
  });
  const secretAccessKey = await readAccessKeySecret(minted.secretId);
  const keys = await listObjects(
    { endpoint: spec.endpoint, region: spec.region, bucket: spec.bucket },
    { accessKeyId: minted.awsAccessKeyId, secretAccessKey },
    spec.prefix,
  );
  return keys.length;
}
