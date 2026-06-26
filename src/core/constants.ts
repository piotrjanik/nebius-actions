/**
 * Centralized named constants for the Nebius core library.
 *
 * Any value that could not be fully confirmed against live Nebius docs/CLI is
 * marked with a `// VERIFY:` comment and is mirrored in the README "Known
 * assumptions" section. Keeping every such value here means verification is
 * a one-line change with no logic touched.
 *
 * Confirmation status (web-verified 2026-06-22):
 *  - CONFIRMED: CLI binary name `nebius`; install via the curl script URL below;
 *    `nebius ai job {create,list,get,get-by-name,logs,cancel,delete,ssh}`;
 *    `nebius ai endpoint ...` group exists; global `--format json`; job flags
 *    `--name --image --container-command --preset --platform --env --timeout`;
 *    IAM token env var `NEBIUS_IAM_TOKEN`; OIDC issuer + token-exchange URL.
 *  - VERIFY: exact job/endpoint status enum spellings; where the container exit
 *    code surfaces in CLI JSON; endpoint subcommand verbs + URL field; pinning a
 *    specific CLI version via the install script.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Default Nebius RFC-8693 token-exchange endpoint (EU region). CONFIRMED (spec §6). */
export const DEFAULT_TOKEN_EXCHANGE_URL = 'https://auth.eu.nebius.com/oauth2/token/exchange';

/** GitHub Actions OIDC issuer. CONFIRMED. */
export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

/** RFC-8693 grant type. CONFIRMED (RFC-8693 §2.1). */
export const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';

/** RFC-8693 requested token type (an access token). CONFIRMED. */
export const REQUESTED_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

/** RFC-8693 subject token type (the GitHub OIDC JWT). CONFIRMED. */
export const SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** The CLI binary name on PATH. CONFIRMED. */
export const CLI_BINARY_NAME = 'nebius';

/** tool-cache tool id used to cache the installed CLI. */
export const CLI_TOOL_CACHE_NAME = 'nebius-cli';

/**
 * Official Linux install script. CONFIRMED 2026-06-22.
 * (The legacy `storage.ai.nebius.cloud/nebius/install.sh` is deprecated.)
 */
export const CLI_INSTALL_SCRIPT_URL = 'https://storage.eu-north1.nebius.cloud/cli/install.sh';

/**
 * Environment variable the CLI/SDK reads for a short-lived IAM access token.
 * CONFIRMED: `NEBIUS_IAM_TOKEN`.
 */
export const IAM_TOKEN_ENV = 'NEBIUS_IAM_TOKEN';

/** Global CLI flag pair that selects machine-readable JSON output. CONFIRMED. */
export const CLI_FORMAT_FLAG = '--format';
export const CLI_FORMAT_JSON = 'json';

/** Default region/profile prefix used by the actions. CONFIRMED default per spec §5. */
export const DEFAULT_REGION = 'eu';

// ---------------------------------------------------------------------------
// CLI command groups / verbs
// ---------------------------------------------------------------------------

/** `nebius ai job ...` — CONFIRMED. */
export const CLI_JOB_GROUP = ['ai', 'job'] as const;
/** `nebius ai endpoint ...` — CONFIRMED the group exists; verbs below are VERIFY. */
export const CLI_ENDPOINT_GROUP = ['ai', 'endpoint'] as const;

/**
 * Endpoint subcommand verbs.
 * `deploy` is modeled as create-or-update. // VERIFY: exact verb names; Nebius
 * may expose `create`/`update`/`apply` separately rather than a single upsert.
 */
export const CLI_ENDPOINT_VERBS = {
  create: 'create',
  update: 'update',
  get: 'get',
  getByName: 'get-by-name',
  delete: 'delete',
} as const;

/**
 * JSON field on an endpoint that carries the public HTTPS URL.
 * Nebius (CONFIRMED v0.12.x) returns the served URL(s) as an array under
 * `status.public_endpoints`; the others are kept as tolerant fallbacks.
 */
export const ENDPOINT_URL_FIELDS = [
  'url',
  'public_url',
  'publicUrl',
  'endpoint_url',
  'public_endpoints.0',
] as const;

// ---------------------------------------------------------------------------
// Job status enum
// ---------------------------------------------------------------------------

/**
 * Job status spellings. // VERIFY: exact enum casing/values from CLI JSON.
 * COMPLETED/FAILED/CANCELLED are referenced in Nebius serverless docs; RUNNING,
 * QUEUED, PENDING are the most likely in-flight states. Comparisons are
 * case-insensitive (see jobs.ts) so casing differences are tolerated.
 */
export const JOB_STATUS = {
  queued: 'QUEUED',
  pending: 'PENDING',
  starting: 'STARTING',
  running: 'RUNNING',
  completed: 'COMPLETED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
} as const;

/** Terminal job statuses (no further transition expected). VERIFY (see JOB_STATUS). */
export const JOB_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  JOB_STATUS.completed,
  JOB_STATUS.failed,
  JOB_STATUS.cancelled,
]);

/** Job statuses considered a success. VERIFY (see JOB_STATUS). */
export const JOB_SUCCESS_STATUSES: ReadonlySet<string> = new Set([JOB_STATUS.completed]);

/**
 * Candidate JSON paths (dot notation) where the container exit code surfaces.
 * // VERIFY: actual location in CLI JSON output.
 */
export const JOB_EXIT_CODE_FIELDS = [
  'exit_code',
  'exitCode',
  'status.exit_code',
  'status.exitCode',
  'result.exit_code',
  'result.exitCode',
] as const;

// ---------------------------------------------------------------------------
// Endpoint status enum
// ---------------------------------------------------------------------------

/**
 * Endpoint status spellings. // VERIFY: exact enum casing/values from CLI JSON.
 * Comparisons are case-insensitive (see endpoints.ts).
 */
export const ENDPOINT_STATUS = {
  creating: 'CREATING',
  updating: 'UPDATING',
  pending: 'PENDING',
  deploying: 'DEPLOYING',
  ready: 'READY',
  active: 'ACTIVE',
  running: 'RUNNING',
  failed: 'FAILED',
  error: 'ERROR',
  deleting: 'DELETING',
  deleted: 'DELETED',
} as const;

/** Endpoint statuses that mean "serving / ready". VERIFY (see ENDPOINT_STATUS). */
export const ENDPOINT_READY_STATUSES: ReadonlySet<string> = new Set([
  ENDPOINT_STATUS.ready,
  ENDPOINT_STATUS.active,
  ENDPOINT_STATUS.running,
]);

/** Endpoint statuses that are a terminal failure. VERIFY (see ENDPOINT_STATUS). */
export const ENDPOINT_TERMINAL_FAILURE_STATUSES: ReadonlySet<string> = new Set([
  ENDPOINT_STATUS.failed,
  ENDPOINT_STATUS.error,
]);

// ---------------------------------------------------------------------------
// Polling / backoff defaults
// ---------------------------------------------------------------------------

/** Default first poll interval (ms). CONFIRMED design default. */
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

/**
 * Lower bound for the poll interval. A non-positive interval would make
 * exponential growth stay at 0 forever (ceil(0 * factor) === 0), busy-looping
 * the API; we floor to 1s so the loop always makes progress.
 */
export const MIN_POLL_INTERVAL_MS = 1_000;

/** Exponential-backoff cap (ms). CONFIRMED design default (spec §4 poll). */
export const DEFAULT_MAX_POLL_INTERVAL_MS = 30_000;

/** Default overall poll timeout (ms): 1 hour. Sensible default; callers override. */
export const DEFAULT_POLL_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Buffer (ms) added to a job's own run timeout when deriving the action's
 * polling deadline, so the action does not race the job's server-side timeout
 * and can observe the resulting terminal status. 5 minutes.
 */
export const POLL_TIMEOUT_BUFFER_MS = 5 * 60 * 1000;

/** Backoff growth factor between polls. */
export const DEFAULT_POLL_BACKOFF_FACTOR = 1.5;
