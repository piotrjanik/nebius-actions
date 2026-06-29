/**
 * Endpoint domain wrappers over the `@nebius/js-sdk` `EndpointService` gRPC API
 * (`nebius.ai.v1`).
 *
 * The I/O functions take an injected `EndpointServiceLike` so they are unit
 * testable with a tiny fake (no network, no SDK construction). The spec/metadata
 * builders and the SDK->domain mapper are pure and exported for direct testing.
 *
 * Notes on the SDK surface (verified against @nebius/js-sdk 0.2.27):
 *   - `EndpointSpec` has NO replica/scaling fields and NO auth *mode*; only a
 *     bearer `authToken` and a `publicIp` flag. Inputs the SDK can't express
 *     (min/max replicas, auth mode, raw passthrough) are intentionally dropped.
 *   - `create`/`delete` return an Operation (via `.result`); the new resource id
 *     is `op.resourceId()`. `get` takes an id; `getByName` needs `{parentId,name}`.
 *   - The served URL(s) surface as `status.publicEndpoints[]`; state is an enum
 *     whose `.name` is the status string (e.g. `RUNNING`, `ERROR`).
 */

// The SDK exposes `./api/*` as a wildcard subpath export. Runtime (node/ncc/
// vitest) resolves it via the exports map; TS `moduleResolution: Node` cannot,
// so tsconfig `paths` maps it to the generated d.ts for typechecking only.
import {
  CreateEndpointRequest,
  DeleteEndpointRequest,
  EndpointSpec as SdkEndpointSpec,
  GetEndpointByNameRequest,
  GetEndpointRequest,
} from '@nebius/js-sdk/api/nebius/ai/v1/index';
import {
  ENDPOINT_READY_STATUSES,
  ENDPOINT_STATUS,
  ENDPOINT_TERMINAL_FAILURE_STATUSES,
} from '../constants';

/** Inputs accepted by the endpoint actions, mapped onto the SDK `EndpointSpec`. */
export interface EndpointSpec {
  name: string;
  image: string;
  /** Container port the served process listens on (-> ports[].containerPort). */
  port?: number;
  preset?: string;
  platform?: string;
  env?: Record<string, string>;
  /** Nebius project id (-> metadata.parentId). */
  projectId?: string;
  /** Expose a public IP (-> publicIp). */
  public?: boolean;
  /** Bearer token to require on the served URL (-> authToken). */
  token?: string;
}

/** Normalized endpoint shape returned to entrypoints. */
export interface Endpoint {
  id: string;
  name: string;
  status: string;
  url?: string;
  raw: unknown;
}

/** Minimal Operation surface used here (satisfied by the SDK's Operation). */
export interface OperationLike {
  resourceId(): string;
  raw?(): unknown;
}

/** Minimal Endpoint service surface (satisfied by the SDK's `EndpointService`). */
export interface EndpointServiceLike {
  create(req: CreateEndpointRequest): { result: Promise<OperationLike> };
  delete(req: DeleteEndpointRequest): { result: Promise<OperationLike> };
  get(req: GetEndpointRequest): PromiseLike<unknown>;
  getByName(req: GetEndpointByNameRequest): PromiseLike<unknown>;
}

/** Build the SDK `ResourceMetadata` partial from a spec (pure). */
export function buildEndpointMetadata(s: EndpointSpec): { name: string; parentId?: string } {
  if (!s.name) {
    throw new Error('EndpointSpec.name is required.');
  }
  return { name: s.name, ...(s.projectId ? { parentId: s.projectId } : {}) };
}

interface EndpointSpecPartial {
  image: string;
  preset?: string;
  platform?: string;
  publicIp?: boolean;
  authToken?: string;
  ports?: { containerPort: number }[];
  environmentVariables?: { name: string; value: string }[];
}

/** Build the SDK `EndpointSpec` partial from a spec (pure). */
export function buildEndpointSpec(s: EndpointSpec): EndpointSpecPartial {
  if (!s.image) {
    throw new Error('EndpointSpec.image is required.');
  }
  const spec: EndpointSpecPartial = { image: s.image };
  if (s.preset) spec.preset = s.preset;
  if (s.platform) spec.platform = s.platform;
  if (s.public) spec.publicIp = true;
  if (s.token) spec.authToken = s.token;
  if (s.port !== undefined) spec.ports = [{ containerPort: s.port }];
  const env = Object.entries(s.env ?? {});
  if (env.length > 0) {
    spec.environmentVariables = env.map(([name, value]) => ({ name, value }));
  }
  return spec;
}

/** Read the status string from an SDK status (enum `.name`) or a plain object. */
function readState(status: unknown): string {
  const st = (status as { state?: unknown } | undefined)?.state;
  if (st == null) return 'UNKNOWN';
  if (typeof st === 'string') return st;
  const name = (st as { name?: unknown }).name;
  if (typeof name === 'string') return name;
  return String(st);
}

/**
 * Map an SDK `Endpoint` (or a plain object in tests) into the domain `Endpoint`.
 * Reads id/name from `metadata`, status from `status.state`, and the served URL
 * from `status.publicEndpoints[0]`, normalizing it to an `https://` URL.
 */
export function mapSdkEndpoint(raw: unknown): Endpoint {
  const e = (raw ?? {}) as {
    metadata?: { id?: string; name?: string };
    status?: { publicEndpoints?: unknown[] };
  };
  const id = e.metadata?.id ?? '';
  const name = e.metadata?.name ?? '';
  const status = readState(e.status);
  const url = e.status?.publicEndpoints?.[0];

  const endpoint: Endpoint = { id, name, status, raw };
  if (typeof url === 'string' && url !== '') {
    endpoint.url = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }
  return endpoint;
}

/** Whether a gRPC error indicates the endpoint already exists (name collision). */
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 6) return true; // gRPC ALREADY_EXISTS
  const msg = err instanceof Error ? err.message : String(err);
  return /already[\s_-]?exists|conflict/i.test(msg);
}

/**
 * Create an endpoint. The SDK has no update verb, so on a name collision this
 * returns the EXISTING endpoint via get-by-name (which needs the project id) —
 * it never replaces it. Any other error propagates (no silent failures).
 */
export async function deployEndpoint(
  service: EndpointServiceLike,
  s: EndpointSpec,
): Promise<Endpoint> {
  const req = CreateEndpointRequest.create({
    metadata: buildEndpointMetadata(s),
    spec: SdkEndpointSpec.create(buildEndpointSpec(s)),
  });

  let op: OperationLike;
  try {
    op = await service.create(req).result;
  } catch (err) {
    if (isAlreadyExists(err) && s.projectId) {
      return getEndpointByName(service, s.projectId, s.name);
    }
    throw err;
  }

  return {
    id: op.resourceId(),
    name: s.name,
    status: ENDPOINT_STATUS.provisioning,
    raw: op.raw?.() ?? op,
  };
}

/** Get an endpoint by id. */
export async function getEndpoint(service: EndpointServiceLike, id: string): Promise<Endpoint> {
  if (!id) {
    throw new Error('getEndpoint: id is required.');
  }
  const ep = await service.get(GetEndpointRequest.create({ id }));
  return mapSdkEndpoint(ep);
}

/** Get an endpoint by name within a project. */
export async function getEndpointByName(
  service: EndpointServiceLike,
  projectId: string,
  name: string,
): Promise<Endpoint> {
  if (!projectId || !name) {
    throw new Error('getEndpointByName: projectId and name are required.');
  }
  const ep = await service.getByName(GetEndpointByNameRequest.create({ parentId: projectId, name }));
  return mapSdkEndpoint(ep);
}

/** Delete an endpoint by id. */
export async function deleteEndpoint(service: EndpointServiceLike, id: string): Promise<void> {
  if (!id) {
    throw new Error('deleteEndpoint: id is required.');
  }
  await service.delete(DeleteEndpointRequest.create({ id })).result;
}

/** True when the endpoint is serving (case-insensitive). */
export function isEndpointReady(status: string): boolean {
  return ENDPOINT_READY_STATUSES.has(status.trim().toUpperCase());
}

/** True when the endpoint is in a terminal failure state (case-insensitive). */
export function isEndpointTerminalFailure(status: string): boolean {
  return ENDPOINT_TERMINAL_FAILURE_STATUSES.has(status.trim().toUpperCase());
}
