# Nebius GitHub Actions

Composable **GitHub Actions for [Nebius AI Cloud](https://nebius.com/)** that run GPU/CPU workloads straight from a workflow:

- **Training Jobs** — finite workloads (training, fine-tuning, batch) that run to completion.
- **Endpoints** — serve a container/model behind a managed HTTPS URL.

They are **primitives**, not an opinionated train→deploy pipeline: one convenience action per resource for fire-and-wait, plus low-level actions so you can wire up `submit → wait → cancel` / `deploy → wait → delete` yourself.

Auth is **keyless** — GitHub OIDC exchanged for a short-lived Nebius IAM token (RFC-8693). No long-lived Nebius secret is stored in your repo. Endpoints and the token exchange use the official [`@nebius/js-sdk`](https://github.com/nebius/js-sdk) over gRPC; Jobs drive the `nebius` CLI (installed by `setup`).

---

## Setup

### 1. Nebius side (one-time)

Create a service account, trust your repo's GitHub OIDC identity, and grant it roles — all keyless. Do this once with the `nebius` CLI (or the web console):

```bash
# Service account the workflow acts as
nebius iam service-account create --parent-id "$NEBIUS_PROJECT_ID" --name github-actions-ci

# Trust GitHub OIDC for a specific repo + ref (lock the subject down as tightly as you can)
nebius iam federated-credentials create \
  --parent-id "$NEBIUS_PROJECT_ID" --name github-actions-oidc \
  --subject-id "$SA_ID" \
  --oidc-provider-issuer-url "https://token.actions.githubusercontent.com" \
  --federated-subject-id "repo:OWNER/REPO:ref:refs/heads/main"

# Least-privilege role to manage Jobs/Endpoints
nebius iam binding create --parent-id "$NEBIUS_PROJECT_ID" --subject-id "$SA_ID" --role ai.editor
```

> Verify the exact flag names and role against your tenancy (`nebius iam --help`), or perform the same three steps (service account → federated credentials → role binding) in the console.

### 2. Workflow

Each job must request an OIDC token, then run `setup` + `auth` once before any resource action:

```yaml
permissions:
  id-token: write
  contents: read
```

---

## Quickstart

### Run a Job

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
      - uses: OWNER/REPO/actions/setup@v0
      - uses: OWNER/REPO/actions/auth@v0
        with:
          service-account-id: ${{ vars.NEBIUS_SERVICE_ACCOUNT_ID }}
      - uses: OWNER/REPO/actions/run-job@v0
        with:
          name: smoke-train
          image: cr.eu-north1.nebius.cloud/your-project/trainer:latest
          preset: 1gpu-16vcpu-200gb
          command: python train.py --epochs 1
          timeout: 1h
```

`run-job` submits the job, streams its logs, waits for a terminal state, and fails the step if the job did not complete successfully.

### Deploy an Endpoint

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
      - uses: OWNER/REPO/actions/setup@v0
      - uses: OWNER/REPO/actions/auth@v0
        with:
          service-account-id: ${{ vars.NEBIUS_SERVICE_ACCOUNT_ID }}
      - id: deploy
        uses: OWNER/REPO/actions/deploy-endpoint@v0
        with:
          name: my-model
          image: cr.eu-north1.nebius.cloud/your-project/serve:latest
          port: 8080
          preset: 1gpu-16vcpu-200gb
      - run: echo "Serving at ${{ steps.deploy.outputs.url }}"
```

`deploy-endpoint` creates the endpoint and waits until it is serving. There is no update verb — if an endpoint with the same name already exists it is returned unchanged; delete it first to redeploy with a changed spec.

---

## Actions

All are `node24` JavaScript actions referenced as `OWNER/REPO/actions/<name>@v0`. Run `setup` + `auth` once per job; every resource action reads the IAM token from `NEBIUS_IAM_TOKEN`. Endpoint actions use the SDK directly (no `setup` needed); Job actions use the `nebius` CLI.

| Action                  | What it does                                                                                                             | Key inputs                                                                                                                                                                              | Key outputs                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **`setup`**             | Install + cache the `nebius` CLI and put it on `PATH`. Run once per job before any resource action.                      | `cli-version` (`latest`), `install-cli` (`true`), `region` (`eu`)                                                                                                                       | —                               |
| **`auth`**              | Keyless OIDC token exchange; export the IAM token (`NEBIUS_IAM_TOKEN`) for the CLI + downstream steps. Run once per job. | `service-account-id` _(required)_, `auth-method` (`oidc`), `audience`, `domain` (default `api.nebius.cloud:443`)                                                                        | `expires-in`                    |
| **`run-job`**           | Convenience: create a Job, stream logs, poll to a terminal state, fail on non-success.                                   | `image` _(required)_, `name`, `command`, `preset`, `platform`, `env`, `mounts`, `timeout`, `wait` (`true`), `poll-interval` (`10`), `project-id`, `extra-args`                          | `job-id`, `status`, `exit-code` |
| **`submit-job`**        | Low-level: create a Job and return immediately (no waiting).                                                             | `image` _(required)_, `name`, `command`, `preset`, `platform`, `env`, `mounts`, `timeout`, `project-id`, `extra-args`                                                                   | `job-id`, `status`              |
| **`upload-object`**     | Upload a local file to a pre-existing bucket via a short-lived SA-minted S3 key; output the object URI + MysteryBox mount secret. | `source` _(required)_, `bucket` _(required)_, `key` _(required)_, `service-account-id`, `project-id`, `expires-in` (`2h`), `endpoint`, `region` | `object-uri`, `secret-id`       |
| **`wait-for-job`**      | Poll an existing Job until terminal; optionally stream logs.                                                             | `job-id` _(required)_, `timeout`, `poll-interval`, `stream-logs` (`true`)                                                                                                               | `status`, `exit-code`           |
| **`cancel-job`**        | Cancel a running Job.                                                                                                    | `job-id` _(required)_                                                                                                                                                                   | `status`                        |
| **`deploy-endpoint`**   | Convenience: create an Endpoint (no update verb), poll until serving.                                                    | `name` _(required)_, `image` _(required)_, `port`, `public`, `token`, `preset`, `platform`, `env`, `wait` (`true`), `timeout`, `poll-interval`, `project-id`                            | `endpoint-id`, `url`, `status`  |
| **`wait-for-endpoint`** | Poll an existing Endpoint until it is serving.                                                                           | `endpoint-id` _(required)_, `timeout`, `poll-interval`                                                                                                                                  | `status`, `url`                 |
| **`delete-endpoint`**   | Delete an Endpoint (by id, or by name + `project-id`).                                                                   | `endpoint-id` _or_ (`name` + `project-id`)                                                                                                                                              | `status`                        |

**Convenience vs. low-level:** `run-job` / `deploy-endpoint` do submit + wait in one step (use `wait: false` to just submit/apply). The low-level actions split the lifecycle across steps for matrix fan-out, manual gating, or cleanup-on-failure.

### Common inputs

- **`project-id`** / **`service-account-id`** — when the `setup` action runs with these, it exports `NEBIUS_PROJECT_ID` / `NEBIUS_SERVICE_ACCOUNT_ID` for the rest of the job, so later resource steps (`create-bucket`, `submit-job`, `upload-object`, `check-object`, `delete-bucket`) can omit them; pass them on a step only to override. `project-id` additionally defaults to the CLI/profile project for plain CLI calls.
- **`region`** — region/profile prefix; default `eu`.
- **`extra-args`** — raw passthrough appended verbatim to the `nebius` CLI call, to reach any flag the typed inputs don't expose.
- **`env`** — multiline `KEY=VALUE` (one per line; blank lines and `#` comments ignored; split on the first `=`).
- **`command`** / **`mounts`** — multiline lists, one entry per line.
- **`poll-interval`** — seconds between status polls (default `10`); backs off exponentially (×1.5) up to a `30s` cap.
- **`timeout`** — for Jobs, the Job's own run timeout (`1h`, `30m`); for `wait-*` actions, how long to poll.

---

## Authentication

Keyless GitHub OIDC → short-lived Nebius IAM token (RFC-8693). No long-lived secret is stored anywhere.

1. The job declares `permissions: { id-token: write, contents: read }`.
2. `auth` obtains GitHub's signed OIDC JWT and runs the `@nebius/js-sdk` federated-credentials exchange over native gRPC — the **service account** is the subject, the **GitHub JWT** the actor.
3. The returned IAM token is masked and exported as **`NEBIUS_IAM_TOKEN`** (via `$GITHUB_ENV`) for the CLI and downstream steps. Lifetime defaults to ~12h.

**Security notes**

- The token lives in `$GITHUB_ENV`, so it's available (masked) to every later step in the same job. Keep it short-lived, scope the SA role to least privilege, and avoid running untrusted actions after `auth`. It is deliberately **not** a step output (outputs can flow into job outputs where masking doesn't reliably carry over).
- The CLI installs via `curl … | bash` from Nebius's official URL with no checksum pinning — a supply-chain trust assumption. Pin `cli-version` to a known-good release where possible.

> Some Nebius API details (status enums, a few field/flag names) are still being verified; they're centralized as `// VERIFY:` comments in `src/core/constants.ts` so a fix is a one-line change. Status comparisons are case-insensitive.

---

## Examples

Copy-pasteable workflows live under [`examples/`](./examples) — replace `OWNER/REPO` and the image/preset values with your own:

- [`train-job.yml`](./examples/train-job.yml) — `setup` + `auth` + `run-job`.
- [`deploy-endpoint.yml`](./examples/deploy-endpoint.yml) — `setup` + `auth` + `deploy-endpoint`, with optional teardown.
- [`submit-and-wait.yml`](./examples/submit-and-wait.yml) — low-level `submit-job` → `wait-for-job`, with `cancel-job` on cancellation.

---

## License

MIT. See [LICENSE](./LICENSE).
