# Nebius GitHub Actions

A suite of composable **GitHub Actions for [Nebius AI Cloud](https://nebius.com/)** that let you run GPU/CPU workloads straight from a workflow:

- **Training Jobs** — finite workloads (training, fine-tuning, batch) that run to completion.
- **Endpoints** — run a container/model behind a managed HTTPS URL.

These actions are **primitives**, not an opinionated train→deploy pipeline. There is one convenience action and several low-level actions per resource, so you can either fire-and-wait in a single step or wire up `submit → wait → cancel` / `deploy → wait → delete` yourself.

Two things make this suite distinct:

- **Keyless auth.** Authentication uses **GitHub OIDC** exchanged for a short-lived Nebius IAM token (RFC-8693 token exchange). No long-lived Nebius secret is ever stored in your repo.
- **SDK / CLI under the hood.** Endpoint operations and the auth/token-exchange path use the official **[`@nebius/js-sdk`](https://github.com/nebius/js-sdk)** over native gRPC. Job operations currently drive the official **`nebius` CLI** (installed by `setup`), which handles retries, pagination, and long-running operations.

> Nebius resource APIs are gRPC-only (no public REST). Endpoints and the keyless token exchange go through the Nebius JS SDK directly (no CLI needed); jobs use the `nebius` CLI, installed and cached for you by the `setup` action.

---

## Table of contents

- [Quickstart (keyless OIDC)](#quickstart-keyless-oidc)
- [Deploy an endpoint](#deploy-an-endpoint)
- [The actions](#the-actions)
- [Common inputs](#common-inputs)
- [Authentication model](#authentication-model)
- [Known assumptions](#known-assumptions)
- [Examples](#examples)
- [License](#license)

---

## Quickstart (keyless OIDC)

### 1. One-time Nebius-side setup (CLI or console)

On the Nebius side you create a service account, trust your GitHub repo's OIDC identity, and grant the service account the roles it needs to manage Jobs and Endpoints. Do this once with the `nebius` CLI (or the web console) — it uses no long-lived keys.

```bash
# 1. A service account the workflow will act as.
nebius iam service-account create \
  --parent-id "$NEBIUS_PROJECT_ID" \
  --name github-actions-ci

# 2. Trust GitHub Actions' OIDC tokens for a specific repo + ref.
#    Lock the federated subject down as tightly as you can, e.g.:
#      repo:OWNER/REPO:ref:refs/heads/main
#      repo:OWNER/REPO:environment:production
nebius iam federated-credentials create \
  --parent-id "$NEBIUS_PROJECT_ID" \
  --name github-actions-oidc \
  --subject-id "$SA_ID" \
  --oidc-provider-issuer-url "https://token.actions.githubusercontent.com" \
  --federated-subject-id "repo:OWNER/REPO:ref:refs/heads/main"

# 3. Grant the SA the least-privilege role(s) to manage Jobs/Endpoints.
nebius iam binding create \
  --parent-id "$NEBIUS_PROJECT_ID" \
  --subject-id "$SA_ID" \
  --role ai.editor
```

> The `federated-credentials` flags above are confirmed against the [Nebius CLI reference](https://docs.nebius.com/cli/reference/iam/federated-credentials/create) (`--subject-id` is the service account the OIDC identity impersonates; `--oidc-provider-issuer-url` is GitHub's issuer). The `service-account create` and `binding create` flag names and the exact role for Jobs/Endpoints still need confirming against your tenancy (`nebius iam --help`) — or perform the same three steps (service account → federated credentials → role binding) in the Nebius web console.

### 2. Workflow setup

Your workflow job must request an OIDC token. Add `permissions: id-token: write` (and `contents: read` to check out code):

```yaml
permissions:
  id-token: write
  contents: read
```

### 3. Authenticate, then run a Job

Run `setup` (installs/caches the `nebius` CLI) and `auth` (performs the OIDC token exchange and exports the IAM token for later steps) once per job, then call any resource action:

```yaml
name: train
on: [workflow_dispatch]

permissions:
  id-token: write
  contents: read

jobs:
  train:
    runs-on: ubuntu-latest
    steps:
      - uses: OWNER/REPO/actions/setup@v1

      - uses: OWNER/REPO/actions/auth@v1
        with:
          service-account-id: ${{ vars.NEBIUS_SERVICE_ACCOUNT_ID }}

      - uses: OWNER/REPO/actions/run-job@v1
        with:
          name: smoke-train
          image: cr.eu-north1.nebius.cloud/your-project/trainer:latest
          preset: 1gpu-16vcpu-200gb
          command: |
            python train.py --epochs 1
          env: |
            WANDB_PROJECT=demo
          timeout: 1h
```

`run-job` submits the job, streams its logs, waits for it to reach a terminal state, and fails the step if the job did not complete successfully.

---

## Deploy an endpoint

```yaml
name: deploy
on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: OWNER/REPO/actions/setup@v1

      - uses: OWNER/REPO/actions/auth@v1
        with:
          service-account-id: ${{ vars.NEBIUS_SERVICE_ACCOUNT_ID }}

      - id: deploy
        uses: OWNER/REPO/actions/deploy-endpoint@v1
        with:
          name: my-model
          image: cr.eu-north1.nebius.cloud/your-project/serve:latest
          port: 8080
          preset: 1gpu-16vcpu-200gb

      - run: echo "Serving at ${{ steps.deploy.outputs.url }}"
```

`deploy-endpoint` **creates** the endpoint and waits until it is serving. The API has no update verb, so if an endpoint with the same name already exists it is returned unchanged (the new spec is **not** applied) — delete it first to redeploy with a changed spec.

---

## The actions

All actions are `node24` JavaScript actions referenced as `OWNER/REPO/actions/<name>@v1`. Every resource action assumes **`auth` ran earlier in the same job** and reads the IAM token from the exported `NEBIUS_IAM_TOKEN` env. The **endpoint** actions talk to the SDK directly, so they do **not** require `setup`. The **job** actions drive the `nebius` CLI and re-ensure it defensively (if `setup` already put `nebius` on `PATH`, this is a no-op — no reinstall), so they still need `setup`.

| Action                  | What it does                                                                                                             | Key inputs                                                                                                                                                                              | Key outputs                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **`setup`**             | Install + cache the `nebius` CLI and put it on `PATH`. Run once per job before any resource action.                      | `cli-version` (`latest`), `install-cli` (`true`), `region` (`eu`)                                                                                                                       | —                               |
| **`auth`**              | Keyless OIDC token exchange; export the IAM token (`NEBIUS_IAM_TOKEN`) for the CLI + downstream steps. Run once per job. | `service-account-id` _(required)_, `auth-method` (`oidc`), `audience`, `domain` (default `api.nebius.cloud:443`)                                                                        | `expires-in`                    |
| **`run-job`**           | Convenience: create a Job, stream logs, poll to a terminal state, fail on non-success.                                   | `image` _(required)_, `name`, `command`, `preset`, `platform`, `env`, `mounts`, `timeout`, `wait` (`true`), `poll-interval` (`10`), `project-id`, `extra-args`                          | `job-id`, `status`, `exit-code` |
| **`submit-job`**        | Low-level: create a Job and return immediately (no waiting).                                                             | `image` _(required)_, `name`, `command`, `preset`, `platform`, `env`, `mounts`, `timeout`, `project-id`, `extra-args`                                                                   | `job-id`, `status`              |
| **`wait-for-job`**      | Poll an existing Job until terminal; optionally stream logs.                                                             | `job-id` _(required)_, `timeout`, `poll-interval`, `stream-logs` (`true`)                                                                                                               | `status`, `exit-code`           |
| **`cancel-job`**        | Cancel a running Job.                                                                                                    | `job-id` _(required)_                                                                                                                                                                   | `status`                        |
| **`deploy-endpoint`**   | Convenience: create an Endpoint (no update verb), poll until serving.                                                    | `name` _(required)_, `image` _(required)_, `port`, `public`, `token`, `preset`, `platform`, `env`, `wait` (`true`), `timeout`, `poll-interval`, `project-id`                            | `endpoint-id`, `url`, `status`  |
| **`wait-for-endpoint`** | Poll an existing Endpoint until it is serving.                                                                           | `endpoint-id` _(required)_, `timeout`, `poll-interval`                                                                                                                                  | `status`, `url`                 |
| **`delete-endpoint`**   | Delete an Endpoint (by id, or by name + `project-id`).                                                                   | `endpoint-id` _or_ (`name` + `project-id`)                                                                                                                                              | `status`                        |

### Convenience vs. low-level

- **Convenience** (`run-job`, `deploy-endpoint`): one step does submit + wait. Use `wait: false` to skip waiting and just submit/apply.
- **Low-level** (`submit-job` + `wait-for-job` + `cancel-job`, and `deploy-endpoint` + `wait-for-endpoint` + `delete-endpoint`): split the lifecycle across steps/jobs for matrix fan-out, manual gating, or cleanup-on-failure.

---

## Common inputs

These conventions apply across the resource actions:

- **`project-id`** — the Nebius project the resource lives in. Defaults to the CLI/profile project when omitted.
- **`region`** — region/profile prefix; default `eu`.
- **`extra-args`** — raw passthrough appended verbatim to the underlying `nebius` CLI call. Use this to reach any flag the typed inputs don't expose.
- **`env`** — multiline `KEY=VALUE`, one pair per line. Blank lines and `#` comments are ignored; the split is on the first `=` (so values may contain `=`).

  ```yaml
  env: |
    WANDB_PROJECT=demo
    LOG_LEVEL=info
    # comments are ignored
  ```

- **`command`** / **`mounts`** — multiline lists, one entry per line (blank lines ignored).
- **`poll-interval`** — seconds between status polls (default `10`); the poller backs off exponentially (factor `1.5`) up to a `30s` cap.
- **`timeout`** — for Jobs this is the Job's own run timeout passed to the CLI (e.g. `1h`, `30m`); for the `wait-*` actions it bounds how long the action polls.

---

## Authentication model

Keyless, GitHub OIDC → short-lived Nebius IAM token. No long-lived secret is stored anywhere.

**One-time (Nebius side, via the `nebius` CLI or console):** create a service account; create a federated credential with `oidc_provider.issuer_url = https://token.actions.githubusercontent.com` and `federated_subject_id` set to the trusted GitHub `sub` (e.g. `repo:OWNER/REPO:ref:refs/heads/main` or `repo:OWNER/REPO:environment:production`); grant the SA roles to manage Jobs/Endpoints. Optionally pin `oidc_provider.jwk_set_json`.

**Runtime (in the workflow):**

1. The workflow declares `permissions: { id-token: write, contents: read }`.
2. `auth` calls `core.getIDToken(audience)` to obtain GitHub's signed OIDC JWT.
3. `auth` runs the **`@nebius/js-sdk`** federated-credentials delegation flow over native gRPC (the HTTP OAuth2 gateway rejects the workload-identity request, so the SDK transport is required). It is an RFC-8693 token exchange where the **subject** is the service account being impersonated and the **actor** is the GitHub JWT:
   - `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`
   - `requested_token_type=urn:ietf:params:oauth:token-type:access_token`
   - `subject_token=<service-account-id>`, `subject_token_type=urn:nebius:params:oauth:token-type:subject_identifier`
   - `actor_token=<github-oidc-jwt>`, `actor_token_type=urn:ietf:params:oauth:token-type:jwt`
   - The SDK returns the IAM access token (and its expiry); the token is masked immediately.
4. `auth` exports the IAM token as the **`NEBIUS_IAM_TOKEN`** environment variable (via `core.exportVariable`, written to `$GITHUB_ENV`) so the CLI and all downstream steps authenticate. (The `nebius` CLI itself is installed separately by `setup`.)

The IAM token lifetime defaults to ~12h when the SDK response omits an expiry.

### Security notes

- **The IAM token is exported to `$GITHUB_ENV`, not as a step output.** It is therefore available (masked) to every subsequent step in the same job, including any third-party actions you run after `auth`. Keep the token short-lived (it is), scope the service-account role to least privilege, and avoid running untrusted actions after `auth` in the same job. The token is deliberately **not** exposed as a step output, since outputs can flow into job-level outputs where the producing job's masking does not reliably carry over.
- **The CLI is installed via `curl … | bash`.** This is Nebius's official install mechanism, but it executes a remote script with no checksum/signature pinning — a supply-chain trust assumption on `storage.eu-north1.nebius.cloud`. Pin `cli-version` to a known-good release where possible, and consider mirroring the installer internally for stricter environments.

---

## Known assumptions

This suite was built against live Nebius docs/CLI (web-verified 2026-06-22), but a number of values could not be fully confirmed and are marked `// VERIFY:` in the source. They are centralized in `src/core/constants.ts` (plus a few in `jobs.ts`, `endpoints.ts`, and `cli/install.ts`) so verification is a one-line change with no logic touched. Comparisons against status enums are **case-insensitive**, so casing differences are tolerated.

**Confirmed (no action needed):**

- CLI binary name `nebius`; install via the curl script `https://storage.eu-north1.nebius.cloud/cli/install.sh` (drops the binary under `~/.nebius/bin`).
- Command groups `nebius ai job …` and `nebius ai endpoint …`; global `--format json`.
- Job create flags: `--name --image --container-command --preset --platform --env --timeout` (and `--project-id`).
- IAM token env var `NEBIUS_IAM_TOKEN`.
- GitHub OIDC issuer; keyless token exchange via `@nebius/js-sdk` federated credentials over gRPC.

**Assumed / to verify:**

| Area                         | Assumption (in code)                                                                                                                                                   | Where (`// VERIFY`)                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Job status enum              | `QUEUED, PENDING, STARTING, RUNNING, COMPLETED, FAILED, CANCELLED`. Terminal = `COMPLETED/FAILED/CANCELLED`; success = `COMPLETED`.                                    | `constants.ts` `JOB_STATUS`, `JOB_TERMINAL_STATUSES`, `JOB_SUCCESS_STATUSES`                      |
| Job exit code location       | Probed at JSON paths `exit_code`, `exitCode`, `status.exit_code`, `status.exitCode`, `result.exit_code`, `result.exitCode`.                                            | `constants.ts` `JOB_EXIT_CODE_FIELDS`                                                             |
| Job JSON field names         | `id`/`status`/`name` probed across `metadata.id`, `status.state`, etc.                                                                                                 | `jobs.ts` `mapJobJson`                                                                            |
| Job mount flag               | `--mount` (most likely spelling).                                                                                                                                      | `jobs.ts` `buildCreateJobArgs`                                                                    |
| Job logs follow flag         | `--follow` for live streaming.                                                                                                                                         | `jobs.ts` `streamJobLogs`                                                                         |
| Endpoint API (SDK)           | `EndpointService` (`nebius.ai.v1`) via `@nebius/js-sdk`: `create`/`delete` return an Operation; `get` (by id) / `getByName` (`parentId`+`name`). No update verb — create only. | `sdk/client.ts`, `endpoints.ts`                                                                   |
| Endpoint spec mapping        | `image`, `ports[].containerPort`, `publicIp`, `authToken`, `preset`, `platform`, `environmentVariables[]`; `name`/`parentId` via metadata. SDK has no replica/auth-mode fields. | `endpoints.ts` `buildEndpointSpec`, `buildEndpointMetadata`                                       |
| Endpoint URL field           | Served URL read from `status.publicEndpoints[0]` (normalized to `https://`).                                                                                           | `endpoints.ts` `mapSdkEndpoint`                                                                   |
| Endpoint status enum         | SDK `EndpointStatus.State`: `PROVISIONING, STARTING, RUNNING, STOPPING, STOPPED, DELETING, ERROR`. Ready = `RUNNING`; terminal failure = `ERROR`.                      | `constants.ts` `ENDPOINT_STATUS`, `ENDPOINT_READY_STATUSES`, `ENDPOINT_TERMINAL_FAILURE_STATUSES` |
| CLI version pinning          | The install script exposes no documented version flag; the requested version is passed as the `NEBIUS_CLI_VERSION` env hint and used as the cache key.                 | `cli/install.ts` `ensureCli`                                                                      |

If a fact turns out wrong, fix the constant (or the small wrapper that references it) — no business logic depends on the literal values.

---

## Examples

Copy-pasteable workflows live under [`examples/`](./examples):

- [`examples/train-job.yml`](./examples/train-job.yml) — `setup` + `auth` + `run-job` (submit, stream logs, wait).
- [`examples/deploy-endpoint.yml`](./examples/deploy-endpoint.yml) — `setup` + `auth` + `deploy-endpoint`, with optional teardown via `delete-endpoint`.
- [`examples/submit-and-wait.yml`](./examples/submit-and-wait.yml) — low-level `submit-job` → `wait-for-job`, with `cancel-job` on cancellation.

Replace `OWNER/REPO` with the repository hosting these actions, and the image/preset values with your own.

---

## License

MIT. See [LICENSE](./LICENSE).
