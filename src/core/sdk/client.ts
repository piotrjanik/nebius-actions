/**
 * SDK client construction for resource actions.
 *
 * Resource actions talk to Nebius over the official `@nebius/js-sdk` gRPC
 * clients (the same SDK `auth` already uses). The IAM token is read from the
 * `NEBIUS_IAM_TOKEN` env var that the `auth` action exports — so the `setup`
 * (CLI install) action is NOT required for the SDK path.
 */

import { SDK } from '@nebius/js-sdk';
// `./api/*` is a wildcard subpath export; runtime resolves it via the exports
// map, tsc via the tsconfig `paths` mapping (see endpoints.ts).
import { EndpointService, JobService } from '@nebius/js-sdk/api/nebius/ai/v1/index';
import { SubnetService } from '@nebius/js-sdk/api/nebius/vpc/v1/index';
import { BucketService } from '@nebius/js-sdk/api/nebius/storage/v1/index';
import { AccessKeyService } from '@nebius/js-sdk/api/nebius/iam/v2/index';
import { PayloadService } from '@nebius/js-sdk/api/nebius/mysterybox/v1/index';
import { IAM_TOKEN_ENV } from '../constants';
import type { EndpointServiceLike } from '../endpoints/endpoints';
import type { JobServiceLike, SubnetServiceLike } from '../jobs/jobs-sdk';
import type { BucketServiceLike } from '../storage/bucket';
import type { AccessKeyServiceLike, KeyServices, PayloadServiceLike } from '../storage/keys';

/**
 * Construct an SDK authenticated with the exported IAM token.
 * @throws when `NEBIUS_IAM_TOKEN` is absent (auth did not run).
 */
export function createSdk(opts?: { domain?: string }): SDK {
  const token = process.env[IAM_TOKEN_ENV];
  if (!token) {
    throw new Error(
      `${IAM_TOKEN_ENV} is not set. Run the 'auth' action before resource actions.`,
    );
  }
  return new SDK({
    credentials: token,
    logger: 'warn', // suppress the SDK's INFO chatter in CI logs
    ...(opts?.domain ? { domain: opts.domain } : {}),
  });
}

/**
 * Build the Endpoint service client for an SDK.
 *
 * The generated client structurally satisfies `EndpointServiceLike` (the narrow
 * interface the endpoints domain depends on), but the generated types are more
 * elaborate than we need, so we cast at this single boundary to keep the domain
 * code and its tests free of SDK type noise.
 */
export function endpointService(sdk: SDK): EndpointServiceLike {
  return new EndpointService(sdk) as unknown as EndpointServiceLike;
}

/**
 * Build the Job service client for an SDK.
 *
 * Like `endpointService`, the generated client structurally satisfies the narrow
 * `JobServiceLike`, so we cast at this single boundary to keep the jobs domain
 * and its tests free of SDK type noise.
 */
export function jobService(sdk: SDK): JobServiceLike {
  return new JobService(sdk) as unknown as JobServiceLike;
}

/**
 * Build the VPC Subnet service client for an SDK. Used to resolve a default
 * subnet for a job when the caller does not pass one explicitly.
 */
export function subnetService(sdk: SDK): SubnetServiceLike {
  return new SubnetService(sdk) as unknown as SubnetServiceLike;
}

/**
 * Build the Object Storage Bucket service client for an SDK (control plane:
 * create/delete the bucket resource; object data still goes over S3).
 */
export function bucketService(sdk: SDK): BucketServiceLike {
  return new BucketService(sdk) as unknown as BucketServiceLike;
}

/** Build the IAM AccessKey service client for an SDK (ephemeral S3 key minting). */
export function accessKeyService(sdk: SDK): AccessKeyServiceLike {
  return new AccessKeyService(sdk) as unknown as AccessKeyServiceLike;
}

/** Build the MysteryBox Payload service client for an SDK (plaintext secret reads). */
export function payloadService(sdk: SDK): PayloadServiceLike {
  return new PayloadService(sdk) as unknown as PayloadServiceLike;
}

/** Build the service pair the storage key-minting flows need. */
export function keyServices(sdk: SDK): KeyServices {
  return { accessKeys: accessKeyService(sdk), payloads: payloadService(sdk) };
}
