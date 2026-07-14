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
  EndpointSpec_Port_Protocol,
  EndpointSpec_VolumeMount_Mode,
  GetEndpointByNameRequest,
  GetEndpointRequest,
} from '@nebius/js-sdk/api/nebius/ai/v1/index';
import { DiskSpec_DiskType } from '@nebius/js-sdk/api/nebius/compute/v1/index';
import { resolveDiskType } from '../sdk/disk';
import { parseMountParts } from '../sdk/mount';
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
  /** Subnet id to deploy into (-> subnetId); auto-resolved by the entrypoint when unset. */
  subnetId?: string;
  /** Main-disk size in bytes (-> disk.sizeBytes). */
  diskSizeBytes?: number;
  /** Disk type key (e.g. `network-ssd`); mapped to the SDK disk-type enum. */
  diskType?: string;
  /** Served port protocol key (`http` | `tcp` | `udp`); default `http`. */
  protocol?: string;
  /** Bucket mounts (`<bucket-id>:/path[:rw|ro]`), one per entry (-> volumes). */
  mounts?: string[];
  /** Entrypoint override (-> containerCommand). */
  command?: string;
  /** Args string passed to the entrypoint (-> args). */
  args?: string;
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

/** Map the `protocol` input key onto the SDK port-protocol enum. */
const PORT_PROTOCOLS: Record<string, EndpointSpec_Port_Protocol> = {
  http: EndpointSpec_Port_Protocol.HTTP,
  tcp: EndpointSpec_Port_Protocol.TCP,
  udp: EndpointSpec_Port_Protocol.UDP,
};

/** Resolve a `protocol` key to the SDK enum, defaulting to HTTP. @throws on unknown. */
function resolveProtocol(protocol?: string): EndpointSpec_Port_Protocol {
  const key = (protocol ?? 'http').toLowerCase();
  const proto = PORT_PROTOCOLS[key];
  if (proto === undefined) {
    throw new Error(`buildEndpointSpec: unknown port protocol '${protocol}'.`);
  }
  return proto;
}

interface EndpointSpecPartial {
  image: string;
  preset?: string;
  platform?: string;
  publicIp?: boolean;
  authToken?: string;
  subnetId?: string;
  ports?: { containerPort: number; protocol: EndpointSpec_Port_Protocol }[];
  disk?: { sizeBytes: number; type: DiskSpec_DiskType };
  environmentVariables?: { name: string; value: string }[];
  volumes?: { source: string; containerPath: string; mode: EndpointSpec_VolumeMount_Mode }[];
  containerCommand?: string;
  args?: string;
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
  if (s.subnetId) spec.subnetId = s.subnetId;
  if (s.port !== undefined) {
    spec.ports = [{ containerPort: s.port, protocol: resolveProtocol(s.protocol) }];
  }
  if (s.diskSizeBytes !== undefined) {
    spec.disk = { sizeBytes: s.diskSizeBytes, type: resolveDiskType(s.diskType) };
  }
  const env = Object.entries(s.env ?? {});
  if (env.length > 0) {
    spec.environmentVariables = env.map(([name, value]) => ({ name, value }));
  }
  if (s.mounts?.length) {
    spec.volumes = s.mounts.map((m) => {
      const { source, containerPath, mode } = parseMountParts(m);
      return {
        source,
        containerPath,
        mode:
          mode === 'ro'
            ? EndpointSpec_VolumeMount_Mode.READ_ONLY
            : EndpointSpec_VolumeMount_Mode.READ_WRITE,
      };
    });
  }
  if (s.command) spec.containerCommand = s.command;
  if (s.args) spec.args = s.args;
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
 * from `status.publicEndpoints[0]`. A value that already carries a scheme is
 * kept as-is; a bare `host:port` (how Nebius reports a public-IP endpoint, which
 * exposes the container port directly over HTTP) is prefixed with `http://`.
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
    endpoint.url = /^https?:\/\//i.test(url) ? url : `http://${url}`;
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
