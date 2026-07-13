/**
 * Orchestrates a single-file upload to Nebius Object Storage:
 *   mint ephemeral key via the SDK (secret -> MysteryBox) -> read plaintext
 *   secret -> S3 PutObject -> return { objectUri, secretId } for the job mount.
 */

import { readFileSync } from 'node:fs';
import { getString, getStringOrEnv } from '../io/inputs';
import { parseDurationMs } from '../time';
import {
  PROJECT_ID_ENV,
  S3_ENDPOINT_DEFAULT,
  S3_REGION_DEFAULT,
  SERVICE_ACCOUNT_ID_ENV,
} from '../constants';
import { ephemeralKeyName, mintS3Credentials, type KeyServices } from './keys';
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
    serviceAccountId: getStringOrEnv('service-account-id', SERVICE_ACCOUNT_ID_ENV, { required: true }),
    projectId: getStringOrEnv('project-id', PROJECT_ID_ENV, { required: true }),
    expiresIn,
    endpoint: getString('endpoint', { default: S3_ENDPOINT_DEFAULT }),
    region: getString('region', { default: S3_REGION_DEFAULT }),
  };
}

/** Run the mint -> upload flow. */
export async function uploadObject(
  services: KeyServices,
  spec: UploadSpec,
  now: () => number = Date.now,
): Promise<UploadResult> {
  const ttlMs = parseDurationMs(spec.expiresIn) ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(now() + ttlMs).toISOString();

  const { minted, secretAccessKey } = await mintS3Credentials(services, {
    projectId: spec.projectId,
    serviceAccountId: spec.serviceAccountId,
    name: ephemeralKeyName('upload', spec.bucket),
    expiresAt,
  });

  const body = readFileSync(spec.source);
  await putObject(
    { endpoint: spec.endpoint, region: spec.region, bucket: spec.bucket, key: spec.key },
    { accessKeyId: minted.awsAccessKeyId, secretAccessKey },
    body,
  );

  return { objectUri: objectUri(spec.bucket, spec.key), secretId: minted.secretId };
}
