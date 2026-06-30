/**
 * Minimal Object Storage upload over the S3 API.
 *
 * Nebius provides no JS object-storage SDK (control plane only), so we use
 * `@aws-sdk/client-s3` pointed at the Nebius S3 endpoint. `forcePathStyle` is on
 * for reliable addressing against a custom endpoint. Pure helpers
 * (`objectUri`, `buildS3ClientConfig`) are unit-tested; the network call is thin.
 */

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

export interface S3Creds {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3Location {
  endpoint: string;
  region: string;
  bucket: string;
}

export interface S3Target extends S3Location {
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

/** List all object keys under a prefix (paginated). Throws on S3 error. */
export async function listObjects(loc: S3Location, c: S3Creds, prefix: string): Promise<string[]> {
  const client = new S3Client(buildS3ClientConfig(loc, c));
  const keys: string[] = [];
  try {
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: loc.bucket, Prefix: prefix || undefined, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key) keys.push(o.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  } finally {
    client.destroy();
  }
  return keys;
}

/** Delete objects by key, batched at the S3 limit of 1000 per request. No-op when empty. */
export async function deleteObjects(loc: S3Location, c: S3Creds, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  const client = new S3Client(buildS3ClientConfig(loc, c));
  try {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: loc.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  } finally {
    client.destroy();
  }
}
