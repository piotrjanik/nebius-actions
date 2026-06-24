/**
 * Endpoint domain wrappers over the `nebius ai endpoint` CLI group.
 *
 * `deployEndpoint` creates the endpoint (the `nebius ai endpoint` group has no
 * `update` verb); on a name collision it returns the existing endpoint via
 * get-by-name. Arg-building is pure (`buildDeployEndpointArgs`) for unit-testing;
 * CLI JSON is mapped via `mapEndpointJson`.
 *
 * Flags/fields below are CONFIRMED against nebius CLI v0.12.x: create takes
 * `--container-port --public --auth --token --parent-id`, and the served URL is
 * `status.public_endpoints[0]`.
 */

import { runCli } from '../cli/exec';
import { firstString } from '../json';
import {
  CLI_ENDPOINT_GROUP,
  CLI_ENDPOINT_VERBS,
  ENDPOINT_URL_FIELDS,
  ENDPOINT_READY_STATUSES,
  ENDPOINT_TERMINAL_FAILURE_STATUSES,
} from '../constants';

export interface EndpointSpec {
  name: string;
  image: string;
  /** Container port the served process listens on (emitted as --container-port). */
  port?: number;
  preset?: string;
  platform?: string;
  env?: Record<string, string>;
  minReplicas?: number;
  maxReplicas?: number;
  projectId?: string;
  /** Expose a public HTTPS URL (--public). */
  public?: boolean;
  /** Auth mode for the served URL, e.g. 'token' (--auth). */
  auth?: string;
  /** Bearer token when auth='token' (--token). */
  token?: string;
  extraArgs?: string[];
}

export interface Endpoint {
  id: string;
  name: string;
  status: string;
  url?: string;
  raw: unknown;
}

const EP = [...CLI_ENDPOINT_GROUP];

/**
 * Build `nebius ai endpoint <verb> ...` args from a spec (pure).
 * @param verb create | update (apply path picks one at runtime).
 * // VERIFY: flag names (--port/--min-replicas/--max-replicas spellings).
 */
export function buildDeployEndpointArgs(s: EndpointSpec, verb: 'create' | 'update'): string[] {
  if (!s.name) {
    throw new Error('EndpointSpec.name is required.');
  }
  if (!s.image) {
    throw new Error('EndpointSpec.image is required.');
  }
  const args = [...EP, verb, '--name', s.name, '--image', s.image];

  if (s.port !== undefined) {
    args.push('--container-port', String(s.port));
  }
  if (s.preset) {
    args.push('--preset', s.preset);
  }
  if (s.platform) {
    args.push('--platform', s.platform);
  }
  if (s.public) {
    args.push('--public');
  }
  if (s.auth) {
    args.push('--auth', s.auth);
  }
  if (s.token) {
    args.push('--token', s.token);
  }
  if (s.minReplicas !== undefined) {
    args.push('--min-replicas', String(s.minReplicas));
  }
  if (s.maxReplicas !== undefined) {
    args.push('--max-replicas', String(s.maxReplicas));
  }
  if (s.projectId) {
    args.push('--parent-id', s.projectId);
  }
  if (s.env) {
    for (const [k, v] of Object.entries(s.env)) {
      args.push('--env', `${k}=${v}`);
    }
  }
  if (s.extraArgs && s.extraArgs.length > 0) {
    args.push(...s.extraArgs);
  }
  return args;
}

/** Extract the public HTTPS URL from candidate fields (incl. nested status). */
function extractUrl(obj: Record<string, unknown>): string | undefined {
  const candidates = [...ENDPOINT_URL_FIELDS, ...ENDPOINT_URL_FIELDS.map((f) => `status.${f}`)];
  return firstString(obj, candidates);
}

/**
 * Map CLI JSON for a single endpoint into the typed `Endpoint`.
 * // VERIFY: exact field names; full payload retained in `raw`.
 */
export function mapEndpointJson(raw: unknown): Endpoint {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const id = firstString(obj, ['id', 'metadata.id', 'endpoint_id', 'endpointId']) ?? '';
  const name = firstString(obj, ['name', 'metadata.name', 'spec.name']) ?? '';
  const status =
    firstString(obj, ['status', 'state', 'status.state', 'status.phase', 'status.status']) ??
    'UNKNOWN';
  const url = extractUrl(obj);

  const endpoint: Endpoint = { id, name, status, raw };
  if (url !== undefined) {
    // The CLI may return a bare host; normalize to an https:// URL.
    endpoint.url = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }
  return endpoint;
}

/** Whether an error message indicates a name collision (endpoint already exists). */
function isAlreadyExists(message: string): boolean {
  return /already[\s_-]?exists|conflict/i.test(message);
}

/**
 * Deploy an endpoint. The `nebius ai endpoint` CLI has no `update` verb, so this
 * creates the endpoint; on a name collision it returns the existing one
 * (get-by-name, which needs the project id). Any other failure propagates.
 */
export async function deployEndpoint(s: EndpointSpec): Promise<Endpoint> {
  try {
    const created = await runCli(buildDeployEndpointArgs(s, CLI_ENDPOINT_VERBS.create), {
      json: true,
    });
    return mapEndpointJson(created.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAlreadyExists(msg) && s.projectId) {
      const existing = await runCli(
        [...EP, CLI_ENDPOINT_VERBS.getByName, '--parent-id', s.projectId, '--name', s.name],
        { json: true },
      );
      return mapEndpointJson(existing.data);
    }
    throw err;
  }
}

/** Get an endpoint by id or name. */
export async function getEndpoint(idOrName: string): Promise<Endpoint> {
  if (!idOrName) {
    throw new Error('getEndpoint: idOrName is required.');
  }
  const res = await runCli([...EP, CLI_ENDPOINT_VERBS.get, '--id', idOrName], { json: true });
  return mapEndpointJson(res.data);
}

/** Delete an endpoint by id or name. */
export async function deleteEndpoint(idOrName: string): Promise<void> {
  if (!idOrName) {
    throw new Error('deleteEndpoint: idOrName is required.');
  }
  await runCli([...EP, CLI_ENDPOINT_VERBS.delete, '--id', idOrName], { json: true });
}

/** True when the endpoint is serving (case-insensitive). */
export function isEndpointReady(status: string): boolean {
  return ENDPOINT_READY_STATUSES.has(status.trim().toUpperCase());
}

/** True when the endpoint is in a terminal failure state (case-insensitive). */
export function isEndpointTerminalFailure(status: string): boolean {
  return ENDPOINT_TERMINAL_FAILURE_STATUSES.has(status.trim().toUpperCase());
}
