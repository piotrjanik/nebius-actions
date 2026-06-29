/**
 * Configure a `nebius` CLI profile so the CLI can authenticate itself.
 *
 * `ensureCli` installs the binary, but the CLI also needs `~/.nebius/config.yaml`
 * with an active profile (endpoint + credentials) — without it every CLI call
 * fails with "missing configuration". When key credentials are supplied we
 * create + activate a service-account-key profile: the CLI signs a JWT with the
 * private key to mint IAM tokens for each call (this is the CLI counterpart to
 * the SDK's key auth in `auth/key.ts`).
 *
 * The private key is written to a 0600 file under RUNNER_TEMP (job-scoped, auto
 * cleaned by the runner). The profile references it BY PATH, so the file must
 * persist for the whole job — we deliberately do NOT delete it. The key is
 * masked so it never appears in logs.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCli } from './exec';
import { mask } from '../io/log';

export interface CliProfileOptions {
  /** Service account the key authenticates as (`serviceaccount-…`). */
  serviceAccountId: string;
  /** The registered public key id (the signed JWT `kid`). */
  publicKeyId: string;
  /** The PEM-encoded private key half of the authorized key. */
  privateKeyPem: string;
  /** Profile name to create + activate (default `ci`). */
  name?: string;
  /** API endpoint (default `api.nebius.cloud`). */
  endpoint?: string;
  /** Default parent id for the profile (the project). */
  parentId?: string;
  /** Default tenant id for the profile. */
  tenantId?: string;
}

const DEFAULT_PROFILE = 'ci';
const DEFAULT_ENDPOINT = 'api.nebius.cloud';

/**
 * Create and activate a key-based `nebius` CLI profile.
 * @throws on missing key inputs or any CLI failure (no silent fallback).
 */
export async function configureCliProfile(o: CliProfileOptions): Promise<void> {
  if (!o.serviceAccountId) {
    throw new Error('configureCliProfile: serviceAccountId is required.');
  }
  if (!o.publicKeyId) {
    throw new Error('configureCliProfile: publicKeyId is required.');
  }
  if (!o.privateKeyPem) {
    throw new Error('configureCliProfile: privateKeyPem is required.');
  }

  mask(o.privateKeyPem);

  const tmpDir = process.env.RUNNER_TEMP || os.tmpdir();
  const keyPath = path.join(tmpDir, 'nebius-sa-private-key.pem');
  const pem = o.privateKeyPem.endsWith('\n') ? o.privateKeyPem : `${o.privateKeyPem}\n`;
  await fs.writeFile(keyPath, pem, { mode: 0o600 });

  const name = o.name || DEFAULT_PROFILE;
  const createArgs = [
    'profile',
    'create',
    name,
    '--endpoint',
    o.endpoint || DEFAULT_ENDPOINT,
    '--service-account-id',
    o.serviceAccountId,
    '--public-key-id',
    o.publicKeyId,
    '--private-key-file-path',
    keyPath,
  ];
  if (o.parentId) {
    createArgs.push('--parent-id', o.parentId);
  }
  if (o.tenantId) {
    createArgs.push('--tenant-id', o.tenantId);
  }

  await runCli(createArgs);
  await runCli(['profile', 'activate', name]);
}
