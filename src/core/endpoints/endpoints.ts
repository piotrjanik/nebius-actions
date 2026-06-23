/**
 * Endpoint domain wrappers over the `nebius ai endpoint` CLI group.
 *
 * `deployEndpoint` is modeled as create-or-update (apply): it attempts an update
 * and falls back to create when the endpoint does not yet exist, so callers get
 * idempotent "apply" semantics. Arg-building is pure (`buildDeployEndpointArgs`)
 * for unit-testing; CLI JSON is mapped via `mapEndpointJson`.
 *
 * // VERIFY: the `nebius ai endpoint` group exists (CONFIRMED) but the exact
 * subcommand verbs, flag names, and the URL field are unconfirmed — all are
 * centralized as constants so verification is localized.
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
  port?: number;
  preset?: string;
  platform?: string;
  env?: Record<string, string>;
  minReplicas?: number;
  maxReplicas?: number;
  projectId?: string;
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
    args.push('--port', String(s.port));
  }
  if (s.preset) {
    args.push('--preset', s.preset);
  }
  if (s.platform) {
    args.push('--platform', s.platform);
  }
  if (s.minReplicas !== undefined) {
    args.push('--min-replicas', String(s.minReplicas));
  }
  if (s.maxReplicas !== undefined) {
    args.push('--max-replicas', String(s.maxReplicas));
  }
  if (s.projectId) {
    args.push('--project-id', s.projectId);
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
    endpoint.url = url;
  }
  return endpoint;
}

/** Whether an error message indicates a not-found endpoint. */
function isNotFound(message: string): boolean {
  return /not[\s_-]?found|does not exist|no such/i.test(message);
}

/**
 * Deploy (create-or-update) an endpoint. Tries update first; on a not-found
 * error, creates it. Any other failure propagates (no silent fallback).
 */
export async function deployEndpoint(s: EndpointSpec): Promise<Endpoint> {
  try {
    const res = await runCli(buildDeployEndpointArgs(s, CLI_ENDPOINT_VERBS.update), {
      json: true,
    });
    return mapEndpointJson(res.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isNotFound(msg)) {
      throw err;
    }
  }
  const created = await runCli(buildDeployEndpointArgs(s, CLI_ENDPOINT_VERBS.create), {
    json: true,
  });
  return mapEndpointJson(created.data);
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
