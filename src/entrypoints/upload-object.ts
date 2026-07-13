/**
 * `upload-object` action entrypoint.
 *
 * Uploads a local file to a pre-existing Nebius Object Storage bucket using a
 * short-lived access key minted from the service account via the SDK, and
 * outputs the object URI plus the MysteryBox secret id for a job's S3 mount.
 * Requires the `auth` action to have exported NEBIUS_IAM_TOKEN.
 */

import { createSdk, fail, keyServices, log, setOutput } from '../core';
// Imported from the storage subpath (not the ../core barrel) so @aws-sdk/client-s3 is bundled only into THIS action, not every action.
import { buildUploadSpecFromInputs, uploadObject } from '../core/storage';

async function run(): Promise<void> {
  const spec = buildUploadSpecFromInputs();

  const sdk = createSdk();
  try {
    const result = await log.group('Upload object', async () => {
      const r = await uploadObject(keyServices(sdk), spec);
      log.info(`Uploaded ${r.objectUri} (mount secret: ${r.secretId}).`);
      return r;
    });

    setOutput('object-uri', result.objectUri);
    setOutput('secret-id', result.secretId);
  } finally {
    await sdk.close();
  }
}

run().catch((err) => fail(err));
