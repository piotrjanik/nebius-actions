/**
 * Ephemeral S3 access-key minting via the `@nebius/js-sdk` `AccessKeyService`
 * (`nebius.iam.v2`) + MysteryBox `PayloadService` (`nebius.mysterybox.v1`).
 *
 * Mints a short-lived access key FROM the already-configured service account so
 * the runner can drive the S3 data plane (SigV4 PutObject) for `upload-object` —
 * the SA bearer token does not work for S3. The secret is delivered into
 * MysteryBox (`secretDeliveryMode: MYSTERY_BOX`); the created key carries only
 * the MysteryBox handle (`status.secretReferenceId`), and the runner resolves
 * the plaintext via the MysteryBox payload API. Keeping MysteryBox delivery
 * (rather than INLINE/EXPLICIT) preserves the `secret-id` output jobs use for
 * S3 secret mounts.
 *
 * NOTE: this key is for the runner's own upload, NOT for a job bucket mount —
 * jobs mount a bucket by id (`--volume <bucket-id>:/path:rw`) with no S3 creds.
 *
 * The I/O functions take injected service fakes (mirroring endpoints/jobs); the
 * request builder is pure and exported for direct testing.
 */

import {
  CreateAccessKeyRequest,
  GetAccessKeyRequest,
  SecretDeliveryMode,
} from '@nebius/js-sdk/api/nebius/iam/v2/index';
import { GetPayloadRequest } from '@nebius/js-sdk/api/nebius/mysterybox/v1/index';
import { dayjs } from '@nebius/js-sdk/runtime/protos/index';
import { mask } from '../io/log';

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

/** Minimal Operation surface used here (satisfied by the SDK's Operation). */
export interface KeyOperationLike {
  resourceId(): string;
  /** Poll the operation to completion so the key's status fields are populated. */
  wait(intervalSec?: number): Promise<void>;
}

/** Minimal AccessKey service surface (satisfied by the SDK's `AccessKeyService`). */
export interface AccessKeyServiceLike {
  create(req: CreateAccessKeyRequest): { result: Promise<KeyOperationLike> };
  get(req: GetAccessKeyRequest): PromiseLike<unknown>;
}

/** Minimal MysteryBox payload service surface (satisfied by the SDK's `PayloadService`). */
export interface PayloadServiceLike {
  get(req: GetPayloadRequest): PromiseLike<unknown>;
}

/** The services key minting needs; built once per entrypoint from one SDK. */
export interface KeyServices {
  accessKeys: AccessKeyServiceLike;
  payloads: PayloadServiceLike;
}

/** Max resource-name length accepted by the IAM API. */
const KEY_NAME_MAX = 63;

/**
 * Access-key name for a storage flow, unique per invocation.
 *
 * The name only aids observability, but IAM rejects duplicates
 * (AlreadyExists) — a deterministic `<verb>-<bucket>` breaks the second
 * same-verb step against a bucket while the first key is still alive
 * (keys self-expire at TTL rather than being deleted after use).
 */
export function ephemeralKeyName(verb: string, bucket: string): string {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const base = `${verb}-${bucket}`.slice(0, KEY_NAME_MAX - suffix.length - 1);
  return `${base}-${suffix}`;
}

/** Build the SDK `CreateAccessKeyRequest` (pure). */
export function buildCreateAccessKeyRequest(s: EphemeralKeySpec): CreateAccessKeyRequest {
  if (!s.projectId) throw new Error('EphemeralKeySpec.projectId is required.');
  if (!s.serviceAccountId) throw new Error('EphemeralKeySpec.serviceAccountId is required.');
  return CreateAccessKeyRequest.create({
    metadata: { parentId: s.projectId, ...(s.name ? { name: s.name } : {}) },
    spec: {
      account: {
        type: { $case: 'serviceAccount', serviceAccount: { id: s.serviceAccountId } },
      },
      secretDeliveryMode: SecretDeliveryMode.MYSTERY_BOX,
      ...(s.expiresAt ? { expiresAt: dayjs(s.expiresAt) } : {}),
    },
  });
}

/**
 * Mint the ephemeral key and extract its ids. Create returns an Operation; we
 * wait for it (so the key's status is populated) and then `get` the key for
 * `status.awsAccessKeyId` + `status.secretReferenceId`.
 */
export async function mintEphemeralKey(
  service: AccessKeyServiceLike,
  s: EphemeralKeySpec,
): Promise<MintedKey> {
  const op = await service.create(buildCreateAccessKeyRequest(s)).result;
  await op.wait(1);
  const accessKeyId = op.resourceId();
  if (!accessKeyId) throw new Error('access key id not found in create operation.');

  const key = (await service.get(GetAccessKeyRequest.create({ id: accessKeyId }))) as {
    status?: { awsAccessKeyId?: string; secretReferenceId?: string };
  };
  const awsAccessKeyId = key?.status?.awsAccessKeyId;
  const secretId = key?.status?.secretReferenceId;
  if (!awsAccessKeyId) throw new Error('aws access key id not found on the created key.');
  if (!secretId) throw new Error('MysteryBox secret id not found on the created key.');
  return { accessKeyId, awsAccessKeyId, secretId };
}

/**
 * Fetch and mask the plaintext AWS secret access key for a minted key.
 *
 * Keys minted with `secretDeliveryMode: MYSTERY_BOX` carry no inline secret;
 * the plaintext lives in the MysteryBox secret whose id is
 * `status.secretReferenceId`. The payload is a key/value list with the AWS
 * secret under the `secret` key.
 */
export async function readAccessKeySecret(
  service: PayloadServiceLike,
  secretReferenceId: string,
): Promise<string> {
  if (!secretReferenceId) throw new Error('readAccessKeySecret: secretReferenceId is required.');
  const payload = (await service.get(
    GetPayloadRequest.create({ secretId: secretReferenceId }),
  )) as {
    data?: { key?: string; payload?: { $case?: string; stringValue?: string } }[];
  };
  const entry = payload?.data?.find((e) => e?.key === 'secret');
  const secret =
    entry?.payload?.$case === 'stringValue' ? entry.payload.stringValue : undefined;
  if (!secret) throw new Error('aws secret access key not found in MysteryBox payload.');
  mask(secret);
  return secret;
}

/**
 * Mint an ephemeral key and resolve its plaintext secret — the full flow the
 * storage orchestrators (upload/download/check/empty) share.
 */
export async function mintS3Credentials(
  services: KeyServices,
  s: EphemeralKeySpec,
): Promise<{ minted: MintedKey; secretAccessKey: string }> {
  const minted = await mintEphemeralKey(services.accessKeys, s);
  const secretAccessKey = await readAccessKeySecret(services.payloads, minted.secretId);
  return { minted, secretAccessKey };
}
