/**
 * `upload-object` action entrypoint.
 *
 * Uploads a local file to a pre-existing Nebius Object Storage bucket using a
 * short-lived access key minted from the configured service account, and
 * outputs the object URI plus the MysteryBox secret id for a job's S3 mount.
 */

import { ensureCli, fail, log, setOutput } from '../core';
// Imported from the storage subpath (not the ../core barrel) so @aws-sdk/client-s3 is bundled only into THIS action, not every action.
import { buildUploadSpecFromInputs, uploadObject } from '../core/storage';

async function run(): Promise<void> {
  await ensureCli({ version: 'latest' });
  const spec = buildUploadSpecFromInputs();

  const result = await log.group('Upload object', async () => {
    const r = await uploadObject(spec);
    log.info(`Uploaded ${r.objectUri} (mount secret: ${r.secretId}).`);
    return r;
  });

  setOutput('object-uri', result.objectUri);
  setOutput('secret-id', result.secretId);
}

run().catch((err) => fail(err));
