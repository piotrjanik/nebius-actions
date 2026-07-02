/**
 * Download every object under a bucket prefix to a local directory:
 *   mint ephemeral key (secret -> MysteryBox) -> read plaintext secret ->
 *   list prefix -> GetObject each -> write under dest, preserving each key's
 *   path relative to the prefix.
 * Throws when the prefix matches nothing, so the action doubles as the
 * "model trained" artifact gate (same semantics as check-object).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { getString, getStringOrEnv } from '../io/inputs';
import { parseDurationMs } from '../time';
import {
  PROJECT_ID_ENV,
  S3_ENDPOINT_DEFAULT,
  S3_REGION_DEFAULT,
  SERVICE_ACCOUNT_ID_ENV,
} from '../constants';
import { mintEphemeralKey, readAccessKeySecret } from './keys';
import { getObject, listObjects } from './s3';

export interface DownloadSpec {
  bucket: string;
  prefix: string;
  dest: string;
  serviceAccountId: string;
  projectId: string;
  expiresIn?: string;
  endpoint: string;
  region: string;
}

export interface DownloadResult {
  files: string[];
  dest: string;
}

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2h

/** Read action inputs into a DownloadSpec. */
export function buildDownloadSpecFromInputs(): DownloadSpec {
  return {
    bucket: getString('bucket', { required: true }),
    prefix: getString('prefix', { required: true }),
    dest: getString('dest', { required: true }),
    serviceAccountId: getStringOrEnv('service-account-id', SERVICE_ACCOUNT_ID_ENV, { required: true }),
    projectId: getStringOrEnv('project-id', PROJECT_ID_ENV, { required: true }),
    expiresIn: getString('expires-in', { default: '2h' }),
    endpoint: getString('endpoint', { default: S3_ENDPOINT_DEFAULT }),
    region: getString('region', { default: S3_REGION_DEFAULT }),
  };
}

/**
 * Local path for `key` under `dest`, relative to `prefix`. When the key IS the
 * prefix (single-object download) the object's basename is used. Rejects keys
 * that would resolve outside `dest` (S3 keys may contain `..` segments).
 */
export function destPathForKey(dest: string, prefix: string, key: string): string {
  const rel = (key.startsWith(prefix) ? key.slice(prefix.length) : key).replace(/^\/+/, '');
  const root = normalize(dest);
  if (rel.length === 0) {
    const base = key.split('/').filter(Boolean).pop() ?? '';
    return join(root, base);
  }
  const out = normalize(join(root, rel));
  if (!out.startsWith(root + sep)) {
    throw new Error(`Refusing to write key '${key}' outside dest '${dest}'.`);
  }
  return out;
}

/** Run the mint -> list -> download flow. */
export async function downloadObjects(
  spec: DownloadSpec,
  now: () => number = Date.now,
): Promise<DownloadResult> {
  const ttlMs = parseDurationMs(spec.expiresIn) ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(now() + ttlMs).toISOString();

  const minted = await mintEphemeralKey({
    projectId: spec.projectId,
    serviceAccountId: spec.serviceAccountId,
    name: `download-${spec.bucket}`,
    expiresAt,
  });
  const secretAccessKey = await readAccessKeySecret(minted.secretId);
  const creds = { accessKeyId: minted.awsAccessKeyId, secretAccessKey };
  const loc = { endpoint: spec.endpoint, region: spec.region, bucket: spec.bucket };

  const keys = await listObjects(loc, creds, spec.prefix);
  if (keys.length === 0) {
    throw new Error(
      `No objects under prefix '${spec.prefix}' in bucket '${spec.bucket}' — nothing to download.`,
    );
  }

  const files: string[] = [];
  for (const key of keys) {
    const path = destPathForKey(spec.dest, spec.prefix, key);
    const body = await getObject({ ...loc, key }, creds);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    files.push(path);
  }
  return { files, dest: spec.dest };
}
