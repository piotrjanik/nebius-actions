/**
 * Ephemeral S3 access-key minting via `nebius iam v2 access-key`.
 *
 * Mints a short-lived access key FROM the already-configured service account,
 * with the secret delivered into MysteryBox (`--secret-delivery-mode mystery_box`)
 * so the job can mount the bucket via `…:ro:default@<secret-id>`. The runner
 * fetches the plaintext secret (for its own S3 upload) via `get-secret`.
 *
 * Arg-building is a pure function so it is unit-testable without the CLI.
 * CLI JSON field names are probed tolerantly (see `// VERIFY:` notes).
 */

import { runCli } from '../cli/exec';
import { mask } from '../io/log';
import { firstString } from '../json';
import { CLI_ACCESS_KEY_GROUP } from '../constants';

const GROUP = [...CLI_ACCESS_KEY_GROUP];

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

/** Build `nebius iam v2 access-key create ...` args (pure). */
export function buildMintKeyArgs(s: EphemeralKeySpec): string[] {
  if (!s.projectId) throw new Error('EphemeralKeySpec.projectId is required.');
  if (!s.serviceAccountId) throw new Error('EphemeralKeySpec.serviceAccountId is required.');
  const args = [
    ...GROUP, 'create',
    '--parent-id', s.projectId,
    '--account-service-account-id', s.serviceAccountId,
    '--secret-delivery-mode', 'mystery_box',
  ];
  if (s.name) args.push('--name', s.name);
  if (s.expiresAt) args.push('--expires-at', s.expiresAt);
  return args;
}

/** Mint the ephemeral key and extract its ids (tolerant JSON probing). */
export async function mintEphemeralKey(s: EphemeralKeySpec): Promise<MintedKey> {
  const res = await runCli(buildMintKeyArgs(s), { json: true, silent: true });
  const obj = (res.data ?? {}) as Record<string, unknown>;
  // VERIFY: exact field names from `iam v2 access-key create` JSON.
  const accessKeyId = firstString(obj, ['id', 'metadata.id', 'access_key_id', 'accessKeyId']);
  const awsAccessKeyId = firstString(obj, [
    'aws_access_key_id', 'status.aws_access_key_id', 'awsAccessKeyId', 'status.awsAccessKeyId',
  ]);
  const secretId = firstString(obj, [
    'status.secret_id', 'secret_id', 'status.secretId', 'status.mystery_box.secret_id',
  ]);
  if (!accessKeyId) throw new Error('access key id not found in create response.');
  if (!awsAccessKeyId) throw new Error('aws access key id not found in create response.');
  if (!secretId) throw new Error('MysteryBox secret id not found in create response.');
  return { accessKeyId, awsAccessKeyId, secretId };
}

/** Fetch and mask the plaintext AWS secret access key for a minted key. */
export async function readAccessKeySecret(accessKeyId: string): Promise<string> {
  if (!accessKeyId) throw new Error('readAccessKeySecret: accessKeyId is required.');
  const res = await runCli([...GROUP, 'get-secret', '--id', accessKeyId], {
    json: true,
    silent: true,
  });
  const obj = (res.data ?? {}) as Record<string, unknown>;
  // VERIFY: exact field name for the secret in `get-secret` JSON.
  const secret = firstString(obj, ['secret', 'aws_secret_access_key', 'awsSecretAccessKey', 'value']);
  if (!secret) throw new Error('aws secret access key not found in get-secret response.');
  mask(secret);
  return secret;
}
