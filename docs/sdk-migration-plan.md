# Migration plan: resource actions from `nebius` CLI → `@nebius/js-sdk`

Status: **PLAN ONLY — not yet implemented.** Scope confirmed: migrate all resource
actions (jobs + endpoints) to the SDK; **keep `setup`** as an optional CLI escape
hatch (and as the host for log streaming — see §5).

## 1. Goal & current state

Today `auth` already uses `@nebius/js-sdk` (OIDC→IAM exchange). Every resource
action instead shells out to the `nebius` CLI via `runCli` (`src/core/cli/exec.ts`),
building string args in `src/core/jobs/jobs.ts` and `src/core/endpoints/endpoints.ts`.
The CLI is installed by `setup` (`src/core/cli/install.ts`).

We will replace the CLI calls in the resource domain with the SDK's gRPC service
clients, reusing the IAM token `auth` already exports.

## 2. Why this is feasible (verified against SDK 0.2.27)

- **Auth wiring is trivial**: the SDK accepts `new SDK({ credentials: process.env.NEBIUS_IAM_TOKEN })`
  (README §"Static/Env bearer"), and `auth` already exports `NEBIUS_IAM_TOKEN`. No new auth code.
- **Service clients exist** under `@nebius/js-sdk/.../api/nebius/ai/v1`:
  - `JobServiceClient`: `create`, `get`, `getByName`, `list`, `cancel`, `delete`
  - `EndpointServiceClient`: `create`, `get`, `getByName`, `list`, `delete`, `start`, `stop`
  - Typed `JobSpec` / `EndpointSpec` / `CreateJobRequest{metadata,spec,dryRun}` etc.
- **Operations are first-class**: mutating calls return an `OperationWrapper` with
  `await op.wait(intervalSec)`, `op.done()`, `op.status()`, `op.resourceId()` — this
  replaces our hand-rolled poller for the *create* path and gives us the new id.

## 3. Two gaps that constrain the design (verified)

| Gap | Impact | Decision |
|-----|--------|----------|
| **No log streaming** in the AI service (no `logs`/`follow` method). | `run-job` / `wait-for-job` `stream-logs`, and endpoint log tailing, can't use the SDK. | **Hybrid**: lifecycle via SDK; when `stream-logs: true`, shell out to `nebius ai job logs --follow` *if the CLI is on PATH* (i.e. `setup` ran). If not present, warn once and fall back to status-only polling. This is the main reason to **keep `setup`**. |
| **No `UpdateEndpoint`** (only create/delete/start/stop). | `deploy-endpoint`'s current "create-or-update (apply)" can't be a single SDK call. | `deploy-endpoint` becomes: `getByName` → if absent `create`; if present, **either** error with a clear message **or** (opt-in `replace: true`) `delete`+`create`. Recommend: default to create-if-absent, no implicit destructive replace. *(VERIFY whether a newer SDK adds Update before locking this in.)* |

## 4. Input → SDK spec remapping

`CreateJobRequest = { metadata: ResourceMetadata, spec: JobSpec, dryRun }`,
`ResourceMetadata = { id, parentId, name, ... }`. **`parentId` is the project** —
so `project-id` likely becomes effectively required (CLI used an implicit default
project). *(VERIFY: does the SDK/account resolve a default parent, or must we pass one?)*

### Jobs (`JobSpec`)
| Action input | SDK field | Notes |
|--------------|-----------|-------|
| `image` | `spec.image` | direct |
| `name` | `metadata.name` | |
| `project-id` | `metadata.parentId` | see parent note above |
| `preset` / `platform` | `spec.preset` / `spec.platform` | direct |
| `env` (multiline `KEY=VALUE`) | `spec.environmentVariables: {name,value}[]` | reuse `getKeyValues`, map to objects |
| `command` (multiline tokens) | `spec.containerCommand` (+ `spec.args`) | **Decision needed**: join all tokens into `containerCommand`, or token[0]→`containerCommand`, rest→`args`. Recommend the latter (closer to argv semantics). |
| `timeout` (`1h`,`30m`) | `spec.timeout: Duration` | parse our duration string → proto `Duration`; we already have `src/core/time`. |
| `mounts` (multiline) | `spec.volumes: JobSpec_VolumeMount[]` | structured — need a documented mini-format; **narrower** than free-form CLI mounts. |
| `extra-args` (raw CLI passthrough) | **none** | **Breaking**: no SDK equivalent. Drop it (document removal) — this is the only true capability loss. |

### Endpoints (`EndpointSpec`)
| Action input | SDK field | Notes |
|--------------|-----------|-------|
| `name`/`image`/`preset`/`platform`/`env` | as jobs | |
| `port` | `spec.ports[]` | structured |
| `public` | `spec.publicIp` | bool |
| `min-replicas`/`max-replicas` | scaling fields on `EndpointSpec` | VERIFY exact field names |
| `auth` + `token` | `spec.authToken` | **Resolves P2**: the caller already supplies the token as input, so we set it on the spec and **stop echoing it as an output** (keep `mask()`). Removing the `token` output is the clean fix to the secret-as-output inconsistency. |
| `extra-args` | **none** | same as jobs — drop. |

## 5. File-by-file changes

**New**
- `src/core/sdk/client.ts` — `getSdk()` building `new SDK({ credentials: NEBIUS_IAM_TOKEN, domain?, logger:'warn' })`; lazily cache per process; `close()` in a `finally`.
- `src/core/jobs/sdk-jobs.ts` (or fold into `jobs.ts`) — `createJob/getJob/cancelJob` via `JobServiceClient`, mapping SDK `Job`→ our `Job` type (keep the same public `Job`/`Endpoint` shapes so entrypoints barely change).
- `src/core/endpoints/sdk-endpoints.ts` — same for `EndpointServiceClient` incl. the getByName-then-create flow.

**Changed**
- `src/core/jobs/jobs.ts`, `endpoints/endpoints.ts` — replace `runCli` bodies; keep `buildCreateJobArgs`-style pure spec builders (`buildJobSpec`, `buildEndpointSpec`) for unit tests.
- Entrypoints (`run-job`, `submit-job`, `wait-for-job`, `cancel-job`, `deploy-endpoint`, `wait-for-endpoint`, `delete-endpoint`) — drop the defensive `ensureCli({version:'latest'})` for the SDK path; only call it when `stream-logs` needs the CLI. Remove `setOutput('token', …)` from `deploy-endpoint`.
- `wait-for-*` — keep our `pollUntil` against SDK `get`, OR use `op.wait()` for the create path; reuse `isJob*`/`isEndpoint*` status helpers (map SDK status enums → strings).
- `action.yml` (jobs/endpoints) — remove `extra-args`; mark `project-id` required if VERIFY confirms; remove `token` *output* from `deploy-endpoint`; tighten descriptions.
- `README.md` / `examples/*` — note `setup` is now optional (only for CLI/log-streaming); update input docs.

**Kept (per your choice)**
- `setup` action + `src/core/cli/install.ts` — optional CLI install, now also the enabler for log streaming. README reframes it as optional.

## 6. Testing strategy

- Keep the strong unit-test posture: test the **pure spec builders** (`buildJobSpec`/`buildEndpointSpec`) exhaustively (input→spec mapping, env/command/timeout parsing, mount format, defaults).
- Mock the SDK service clients (inject the client, like `findExisting` is injected today) to test create→`op.wait()`→`resourceId()`→map flows and the getByName-then-create endpoint logic, without network.
- Status-helper tests reused; add SDK-enum→status-string mapping tests.
- Keep the CLI exec tests only for the retained log-streaming shell-out.
- `npm run all` must stay green incl. the **dist-drift check** — every change requires a rebuild+commit of `actions/*/dist`.

## 7. Risks / open VERIFY items (resolve before/while coding)

1. **Default project (`parentId`)** — required or resolvable? Drives whether `project-id` becomes mandatory.
2. **Endpoint update** — confirm no `UpdateEndpoint` in the target SDK version; finalize the apply-vs-create-only behavior.
3. **Log streaming** — confirm there is truly no AI-service logs RPC; confirm CLI `logs --follow` flag spelling (already a `// VERIFY` in `jobs.ts`).
4. **Scaling/min-max replica field names** on `EndpointSpec`.
5. **Status enums** — map SDK `JobStatus_State` / `EndpointStatus_State` to our terminal/success sets (replaces the string-casing tolerance in `constants`).
6. **Bundle size / gRPC in ncc** — `auth` already bundles the SDK+gRPC fine, so this is low risk, but re-check dist sizes.

## 8. Suggested staging (each a self-contained, green PR)

1. **Endpoints → SDK** (smaller surface; resolves P2 token output; exercises operations + getByName-or-create). 
2. **Jobs lifecycle → SDK** (create/get/cancel) with hybrid log streaming.
3. **Cleanup**: remove `extra-args`, reframe `setup` as optional in docs, prune now-dead CLI resource code (keep install + logs).
