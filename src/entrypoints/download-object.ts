/**
 * `download-object` action entrypoint.
 *
 * Downloads every object under a bucket prefix to a local directory using a
 * short-lived access key minted from the configured service account. Fails
 * when the prefix matches nothing, so it doubles as the artifact gate.
 */

import { ensureCli, fail, log, setOutput } from '../core';
// Imported by direct path (not the ../core barrel) so @aws-sdk/client-s3 is bundled only into THIS action, not every action.
import { buildDownloadSpecFromInputs, downloadObjects } from '../core/storage/download';

async function run(): Promise<void> {
  await ensureCli({ version: 'latest' });
  const spec = buildDownloadSpecFromInputs();

  const result = await log.group('Download objects', async () => {
    const r = await downloadObjects(spec);
    log.info(`Downloaded ${r.files.length} object(s) to ${r.dest}.`);
    return r;
  });

  setOutput('files-count', result.files.length);
  setOutput('dest', result.dest);
}

run().catch((err) => fail(err));
