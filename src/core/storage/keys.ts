/**
 * Ephemeral S3 access-key minting via `nebius iam v2 access-key`.
 *
 * Mints a short-lived access key FROM the already-configured service account,
 * with the secret delivered into MysteryBox (`--secret-delivery-mode mystery_box`)
 * so the job can mount the bucket via `…:ro:default@<secret-id>`. The create
 * response carries only the MysteryBox handle (`status.secret_reference_id`); the
 * runner resolves the plaintext secret (for its own S3 upload) via
 * `mysterybox payload get`.
 *
 * Arg-building is a pure function so it is unit-testable without the CLI.
 * CLI JSON field names were confirmed against the live CLI (0.12.x).
 */

import { runCli } from '../cli/exec';
import { mask } from '../io/log';
import { firstString } from '../json';
import { CLI_ACCESS_KEY_GROUP, CLI_MYSTERYBOX_PAYLOAD_GROUP } from '../constants';

const GROUP = [...CLI_ACCESS_KEY_GROUP];
const MYSTERYBOX_PAYLOAD = [...CLI_MYSTERYBOX_PAYLOAD_GROUP];

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
  // Field names confirmed against live CLI 0.12.x: `metadata.id`,
  // `status.aws_access_key_id`, `status.secret_reference_id`. Extra probes are
  // tolerant fallbacks for older/SDK casings.
  const accessKeyId = firstString(obj, ['id', 'metadata.id', 'access_key_id', 'accessKeyId']);
  const awsAccessKeyId = firstString(obj, [
    'aws_access_key_id', 'status.aws_access_key_id', 'awsAccessKeyId', 'status.awsAccessKeyId',
  ]);
  const secretId = firstString(obj, [
    'status.secret_reference_id', 'secret_reference_id', 'status.secretReferenceId',
    'status.secret_id', 'secret_id', 'status.secretId', 'status.mystery_box.secret_id',
  ]);
  if (!accessKeyId) throw new Error('access key id not found in create response.');
  if (!awsAccessKeyId) throw new Error('aws access key id not found in create response.');
  if (!secretId) throw new Error('MysteryBox secret id not found in create response.');
  return { accessKeyId, awsAccessKeyId, secretId };
}

/**
 * Fetch and mask the plaintext AWS secret access key for a minted key.
 *
 * Keys minted with `--secret-delivery-mode mystery_box` reject
 * `access-key get-secret`; the plaintext lives in the MysteryBox secret whose id
 * is `status.secret_reference_id`. Read it via `mysterybox payload get`, whose
 * JSON is `{ data: [{ key, string_value }] }`.
 */
export async function readAccessKeySecret(secretReferenceId: string): Promise<string> {
  if (!secretReferenceId) throw new Error('readAccessKeySecret: secretReferenceId is required.');
  const res = await runCli([...MYSTERYBOX_PAYLOAD, 'get', '--secret-id', secretReferenceId], {
    json: true,
    silent: true,
  });
  const obj = (res.data ?? {}) as Record<string, unknown>;
  const secret = payloadString(obj, 'secret');
  if (!secret) throw new Error('aws secret access key not found in MysteryBox payload.');
  mask(secret);
  return secret;
}

/** Extract a payload entry's plaintext value from `mysterybox payload get` JSON. */
function payloadString(obj: Record<string, unknown>, key: string): string | undefined {
  const data = obj.data;
  if (!Array.isArray(data)) return undefined;
  for (const entry of data) {
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      if (e.key === key) {
        return firstString(e, ['string_value', 'stringValue', 'value']);
      }
    }
  }
  return undefined;
}
