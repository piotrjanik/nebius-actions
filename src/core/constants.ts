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
//
// The RFC-8693 token-exchange request (grant/subject/actor token types and the
// `subject_identifier` delegation flow) is built by the Nebius SDK — see
// `auth/exchange.ts`. No exchange URLs or URN constants are needed here.

/** GitHub Actions OIDC issuer (reference only). */
export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

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

// Endpoint operations no longer use the CLI — they go through the SDK
// `EndpointService` (see `endpoints.ts`). The former CLI endpoint group/verbs and
// URL-field probes were removed with that migration.

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
 * Endpoint status spellings. The SDK (nebius.ai.v1) EndpointStatus.State enum
 * names are authoritative; older/CLI spellings are kept as tolerant fallbacks.
 * Comparisons are case-insensitive (see endpoints.ts).
 */
export const ENDPOINT_STATUS = {
  // SDK EndpointStatus.State enum names (CONFIRMED @nebius/js-sdk 0.2.27):
  provisioning: 'PROVISIONING',
  starting: 'STARTING',
  running: 'RUNNING',
  stopping: 'STOPPING',
  stopped: 'STOPPED',
  deleting: 'DELETING',
  error: 'ERROR',
  // Tolerant fallbacks (older/CLI spellings; harmless extras):
  creating: 'CREATING',
  updating: 'UPDATING',
  pending: 'PENDING',
  deploying: 'DEPLOYING',
  ready: 'READY',
  active: 'ACTIVE',
  failed: 'FAILED',
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

// ---------------------------------------------------------------------------
// Object Storage (S3) — data plane
// ---------------------------------------------------------------------------

/**
 * Default Nebius Object Storage S3 endpoint. // VERIFY: region host.
 * Mirrors the eu-north1 host used by the CLI install script.
 */
export const S3_ENDPOINT_DEFAULT = 'https://storage.eu-north1.nebius.cloud';

/** Default S3 region for Nebius Object Storage. // VERIFY. */
export const S3_REGION_DEFAULT = 'eu-north1';

/** `nebius iam v2 access-key ...` — CONFIRMED group (live CLI). */
export const CLI_ACCESS_KEY_GROUP = ['iam', 'v2', 'access-key'] as const;

/** `nebius mysterybox payload ...` — CONFIRMED group (live CLI). */
export const CLI_MYSTERYBOX_PAYLOAD_GROUP = ['mysterybox', 'payload'] as const;
