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
import { EndpointService } from '@nebius/js-sdk/api/nebius/ai/v1/index';
import { IAM_TOKEN_ENV } from '../constants';
import type { EndpointServiceLike } from '../endpoints/endpoints';

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
