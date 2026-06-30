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
