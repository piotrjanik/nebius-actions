# Nebius GitHub Actions

Run GPU/CPU workloads on [Nebius AI Cloud](https://nebius.com/) straight from a GitHub workflow — no glue scripts.

These are small, composable building blocks (one job per resource), not a rigid pipeline. Mix and match them to **train a model, serve it, and move data** around it. There are three kinds of things you can do:

- 🏃 **Training Jobs** — finite GPU/CPU workloads (train, fine-tune, batch) that run to completion.
- 🌐 **Endpoints** — keep a container/model running behind a public URL.
- 🪣 **Object Storage** — create buckets and upload files into them.

**Auth is short-lived.** You never store a long-lived Nebius secret in your repo. Either exchange GitHub's OIDC identity for a temporary IAM token (recommended, fully keyless), or use a service-account key. One `auth` step exports the token; every other action reuses it.

---

## Quick start

Every job runs `setup` + `auth` once, then any number of resource actions.

**Train a model:**

```yaml
permissions:
  id-token: write # needed for keyless OIDC auth
  contents: read

jobs:
  train:
    runs-on: ubuntu-latest
    steps:
      - uses: piotrjanik/nebius-actions/actions/setup@v0
      - uses: piotrjanik/nebius-actions/actions/auth@v0
        with:
          service-account-id: ${{ vars.NEBIUS_SERVICE_ACCOUNT_ID }}
      - id: submit
        uses: piotrjanik/nebius-actions/actions/submit-job@v0
        with:
          name: smoke-train
          image: cr.eu-north1.nebius.cloud/your-project/trainer:latest
          platform: gpu-l40s-a
          preset: 1gpu-8vcpu-32gb
          command: python train.py --epochs 1
          timeout: 1h
      - uses: piotrjanik/nebius-actions/actions/wait-for-job@v0
        with:
          job-id: ${{ steps.submit.outputs.job-id }}
```

`submit-job` creates the Job and returns as soon as it's accepted; `wait-for-job` streams its logs, polls it to a terminal state, and fails the step if it didn't succeed. Splitting them lets you do other work in between — or, as in the demo, put the two halves in separate GitHub jobs.

**Serve a model:**

```yaml
- id: deploy
  uses: piotrjanik/nebius-actions/actions/deploy-endpoint@v0
  with:
    name: my-model
    image: cr.eu-north1.nebius.cloud/your-project/serve:latest
    port: 8000
    public: true
    platform: gpu-l40s-a
    preset: 1gpu-16vcpu-64gb
    disk-size: 100Gi
    project-id: ${{ vars.NEBIUS_PROJECT_ID }}
- run: curl -fsS "${{ steps.deploy.outputs.url }}/health"
```

`deploy-endpoint` creates the endpoint and waits until it's serving. Deploying a name that already exists returns it unchanged (there's no update verb) — delete it first to redeploy a new spec.

---

## Actions reference

All are referenced as `piotrjanik/nebius-actions/actions/<name>@v0`. Run **`setup` + `auth` once per job**; every other action reads the token from `NEBIUS_IAM_TOKEN`. In the tables, ✅ marks a required input.

### 🔑 Setup & auth

#### `setup`

Install the `nebius` CLI onto the runner and put it on `PATH`. Pass the key inputs to also configure a key-based CLI profile. Job and storage actions use the CLI; endpoint actions don't need it.

| Input                                                                           | Req | Default  | Description                                                       |
| ------------------------------------------------------------------------------- | --- | -------- | ----------------------------------------------------------------- |
| `cli-version`                                                                   |     | `latest` | CLI version to install (pin for reproducibility)                  |
| `region`                                                                        |     | `eu`     | Region/profile prefix                                             |
| `service-account-id`, `public-key-id`, `private-key`, `project-id`, `tenant-id` |     | —        | Configure a key-based CLI profile (also exported for later steps) |

**Outputs:** none — exports `NEBIUS_PROJECT_ID` / `NEBIUS_SERVICE_ACCOUNT_ID` for the rest of the job.

```yaml
- uses: piotrjanik/nebius-actions/actions/setup@v0
  with:
    cli-version: latest
```

#### `auth`

Get a short-lived IAM token and export it as `NEBIUS_IAM_TOKEN` (masked) for the rest of the job.

| Input                          | Req | Default | Description                      |
| ------------------------------ | --- | ------- | -------------------------------- |
| `service-account-id`           | ✅  | —       | Service account to act as        |
| `auth-method`                  |     | `oidc`  | `oidc` (keyless) or `key`        |
| `public-key-id`, `private-key` |     | —       | Required when `auth-method: key` |
| `audience`, `domain`           |     | —       | Advanced overrides               |

**Outputs:** `expires-in`

```yaml
- uses: piotrjanik/nebius-actions/actions/auth@v0
  with:
    service-account-id: ${{ vars.NEBIUS_SERVICE_ACCOUNT_ID }}
    # key auth instead of OIDC:
    # auth-method: key
    # public-key-id: ${{ vars.NEBIUS_PUBLIC_KEY_ID }}
    # private-key: ${{ secrets.NEBIUS_PRIVATE_KEY }}
```

### 🏃 Training Jobs

#### `submit-job`

Create a Job and return as soon as it's accepted, without waiting. Pair with `wait-for-job` — either back-to-back in one job, or in separate GitHub jobs when you want to fan out, gate, or split the run graph.

| Input                     | Req | Default       | Description                             |
| ------------------------- | --- | ------------- | --------------------------------------- |
| `image`                   | ✅  | —             | Container image to run                  |
| `name`                    |     | —             | Job name                                |
| `command`                 |     | —             | Entrypoint (multiline list)             |
| `args`                    |     | —             | Args passed to the entrypoint           |
| `platform`                |     | —             | Compute platform (e.g. `gpu-l40s-a`)    |
| `preset`                  |     | —             | Compute preset (platform-specific)      |
| `env`                     |     | —             | Multiline `KEY=VALUE`                   |
| `mounts`                  |     | —             | `<bucket-id>:/path:rw` (multiline)      |
| `disk-size` / `disk-type` |     | `network-ssd` | Main disk (e.g. `250Gi`)                |
| `preemptible`             |     | `false`       | Use cheaper preemptible VMs             |
| `timeout`                 |     | —             | The Job's own run timeout (`1h`, `30m`) |
| `subnet-id`               |     | auto          | Subnet (auto-resolved from the project) |
| `project-id`              |     | from `setup`  | Parent project                          |

**Outputs:** `job-id`, `status`

```yaml
- id: submit
  uses: piotrjanik/nebius-actions/actions/submit-job@v0
  with:
    name: finetune
    image: cr.eu-north1.nebius.cloud/proj/trainer:latest
    platform: gpu-l40s-a
    preset: 1gpu-8vcpu-32gb
    command: python train.py
    args: --epochs 3
    mounts: ${{ steps.bucket.outputs.bucket-id }}:/data:rw
    timeout: 2h
```

#### `wait-for-job`

Poll an existing Job until it finishes; optionally stream its logs. Fails the step on a failed/cancelled job or timeout.

| Input           | Req | Default | Description                         |
| --------------- | --- | ------- | ----------------------------------- |
| `job-id`        | ✅  | —       | Job to wait on                      |
| `timeout`       |     | `3600`  | Poll ceiling, **in seconds**        |
| `poll-interval` |     | `10`    | Seconds between polls               |
| `stream-logs`   |     | `true`  | Stream the job's logs while polling |

**Outputs:** `status`, `exit-code`

```yaml
- uses: piotrjanik/nebius-actions/actions/wait-for-job@v0
  with:
    job-id: ${{ steps.submit.outputs.job-id }}
    timeout: 7200
```

#### `cancel-job`

Cancel a running Job (e.g. on workflow cancellation).

| Input    | Req | Default | Description   |
| -------- | --- | ------- | ------------- |
| `job-id` | ✅  | —       | Job to cancel |

**Outputs:** `status`

```yaml
- if: cancelled() && steps.submit.outputs.job-id != ''
  uses: piotrjanik/nebius-actions/actions/cancel-job@v0
  with:
    job-id: ${{ steps.submit.outputs.job-id }}
```

### 🌐 Endpoints

#### `deploy-endpoint`

The all-in-one: create an Endpoint and poll until it's serving. A public endpoint is reachable at a plain **`http://<ip>:<port>`** URL (the container port is exposed directly). The subnet is resolved automatically from your project.

| Input                     | Req | Default      | Description                                                                         |
| ------------------------- | --- | ------------ | ----------------------------------------------------------------------------------- |
| `name`                    | ✅  | —            | Endpoint name                                                                       |
| `image`                   | ✅  | —            | Container image to serve                                                            |
| `port`                    |     | —            | Container port to expose                                                            |
| `public`                  |     | `false`      | Assign a public URL                                                                 |
| `protocol`                |     | `HTTP`       | Port protocol (`HTTP`/`TCP`/`UDP`)                                                  |
| `platform`                |     | —            | Compute platform (e.g. `gpu-l40s-a`)                                                |
| `preset`                  |     | —            | Compute preset (platform-specific)                                                  |
| `disk-size` / `disk-type` |     | —            | Main disk (e.g. `100Gi`)                                                            |
| `subnet-id`               |     | auto         | Subnet (auto-resolved from the project)                                             |
| `token`                   |     | —            | Bearer token required to call the endpoint                                          |
| `env`                     |     | —            | Multiline `KEY=VALUE`                                                               |
| `mounts`                  |     | —            | `<bucket-id>:/path:rw` (multiline, mounted by bucket id — no S3 credentials needed) |
| `command`                 |     | —            | Entrypoint override (single string)                                                 |
| `args`                    |     | —            | Args passed to the entrypoint (single string)                                       |
| `wait`                    |     | `true`       | Wait until serving (`false` = just create)                                          |
| `timeout`                 |     | `3600`       | Poll ceiling, **in seconds**                                                        |
| `project-id`              |     | from `setup` | Parent project (needed for subnet auto-resolution)                                  |

**Outputs:** `endpoint-id`, `url`, `status`

```yaml
- id: deploy
  uses: piotrjanik/nebius-actions/actions/deploy-endpoint@v0
  with:
    name: my-model
    image: cr.eu-north1.nebius.cloud/proj/serve:latest
    port: 8000
    public: true
    platform: gpu-l40s-a
    preset: 1gpu-16vcpu-64gb
    disk-size: 100Gi
    project-id: ${{ vars.NEBIUS_PROJECT_ID }}
```

#### `wait-for-endpoint`

Poll an existing Endpoint until it's serving. Use after `deploy-endpoint` with `wait: false`.

| Input           | Req | Default | Description                  |
| --------------- | --- | ------- | ---------------------------- |
| `endpoint-id`   | ✅  | —       | Endpoint to wait on          |
| `timeout`       |     | `3600`  | Poll ceiling, **in seconds** |
| `poll-interval` |     | `10`    | Seconds between polls        |

**Outputs:** `status`, `url`

```yaml
- id: endpoint
  uses: piotrjanik/nebius-actions/actions/wait-for-endpoint@v0
  with:
    endpoint-id: ${{ steps.deploy.outputs.endpoint-id }}
    timeout: 1800
```

#### `delete-endpoint`

Delete an Endpoint by id, or by name + project. Endpoints cost money while up, so tear them down when done (typically in an `if: always()` step).

| Input                | Req | Default | Description                                |
| -------------------- | --- | ------- | ------------------------------------------ |
| `endpoint-id`        |     | —       | Endpoint id (or use `name` + `project-id`) |
| `name`, `project-id` |     | —       | Delete by name within a project            |

**Outputs:** `status`

```yaml
- if: always() && steps.deploy.outputs.endpoint-id != ''
  uses: piotrjanik/nebius-actions/actions/delete-endpoint@v0
  with:
    endpoint-id: ${{ steps.deploy.outputs.endpoint-id }}
```

### 🪣 Object Storage

Storage actions accept **common inputs** in addition to those listed: `service-account-id` and `project-id` (both default to what `setup` exported), `expires-in` (default `2h`, the life of the minted S3 key), `endpoint` (default `https://storage.eu-north1.nebius.cloud`), and `region` (default `eu-north1`).

These actions cover the _upload_ direction. To get results back out of a Job, mount the bucket read-write (`mounts: <bucket-id>:/path:rw`) and have the Job write into it — the objects persist in the bucket after the Job exits.

#### `create-bucket`

Create an Object Storage bucket (control plane).

| Input            | Req | Default | Description       |
| ---------------- | --- | ------- | ----------------- |
| `name`           | ✅  | —       | Bucket name       |
| `max-size-bytes` |     | —       | Optional size cap |

**Outputs:** `bucket-name`, `bucket-id`

```yaml
- id: bucket
  uses: piotrjanik/nebius-actions/actions/create-bucket@v0
  with:
    name: run-${{ github.run_id }}
```

#### `upload-object`

Upload a local file to an existing bucket. Mints a short-lived S3 key from the service account on the fly (no stored S3 credentials).

| Input    | Req | Default | Description              |
| -------- | --- | ------- | ------------------------ |
| `source` | ✅  | —       | Local file path          |
| `bucket` | ✅  | —       | Target bucket name       |
| `key`    | ✅  | —       | Object key in the bucket |

**Outputs:** `object-uri`, `secret-id`

```yaml
- uses: piotrjanik/nebius-actions/actions/upload-object@v0
  with:
    source: ${{ runner.temp }}/config.yaml
    bucket: ${{ steps.bucket.outputs.bucket-name }}
    key: config.yaml
```

#### `delete-bucket`

Empty a bucket and delete it. Safe to run in `if: always()` cleanup.

| Input       | Req | Default | Description                      |
| ----------- | --- | ------- | -------------------------------- |
| `bucket`    | ✅  | —       | Bucket name                      |
| `bucket-id` | ✅  | —       | Bucket id (from `create-bucket`) |

**Outputs:** `deleted-count`

```yaml
- if: always() && steps.bucket.outputs.bucket-id != ''
  uses: piotrjanik/nebius-actions/actions/delete-bucket@v0
  with:
    bucket: ${{ steps.bucket.outputs.bucket-name }}
    bucket-id: ${{ steps.bucket.outputs.bucket-id }}
```

---

## Good to know

- **`setup` exports project/SA ids.** When `setup` runs with `project-id`/`service-account-id`, later storage and job steps can omit them (pass on a step only to override).
- **`env`** is multiline `KEY=VALUE` (one per line; blank lines and `#` comments ignored).
- **`mounts`** is a multiline list, one `<bucket-id>:/container/path:rw` entry per line, on both `submit-job` and `deploy-endpoint`. **`command`** is shaped differently per action: a multiline token list on `submit-job`, but a single string on `deploy-endpoint`.
- **Presets are platform-specific.** A preset name valid on one platform 400s on another — list them with `nebius compute platform list`.
- **Two kinds of `timeout`.** For Jobs it's the Job's own run time (a duration like `1h`/`30m`). For `wait-*` actions it's how long to poll, **in seconds** (a plain number like `3600`).
- **`poll-interval`** is seconds between polls (default `10`), backing off up to ~30s.

---

## Setup (one-time, Nebius side)

Create a service account and let your repo use it — keyless:

```bash
# The service account your workflow acts as
nebius iam service-account create --parent-id "$NEBIUS_PROJECT_ID" --name github-actions-ci

# Trust your repo's GitHub OIDC identity (scope the subject as tightly as you can)
nebius iam federated-credentials create \
  --parent-id "$NEBIUS_PROJECT_ID" --name github-actions-oidc \
  --subject-id "$SA_ID" \
  --oidc-provider-issuer-url "https://token.actions.githubusercontent.com" \
  --federated-subject-id "repo:piotrjanik/nebius-actions:ref:refs/heads/main"

# Least-privilege role to manage Jobs/Endpoints/Storage
nebius iam binding create --parent-id "$NEBIUS_PROJECT_ID" --subject-id "$SA_ID" --role ai.editor
```

> Verify flag names and the role against your tenancy (`nebius iam --help`) or do the same three steps in the web console. Prefer keyless OIDC; if you use a service-account key instead, store the PEM as a repo secret and pass it to `auth`/`setup` as `private-key`.

---

## Examples

Copy-pasteable workflows live under [`examples/`](./examples) — swap the image/preset for your own:

- [`submit-and-wait.yml`](./examples/submit-and-wait.yml) — `setup` + `auth` + `submit-job` → `wait-for-job`, with `cancel-job` on cancellation.
- [`deploy-endpoint.yml`](./examples/deploy-endpoint.yml) — `setup` + `auth` + `deploy-endpoint`, with teardown.

For a full **train-to-serve** pipeline, see [`.github/workflows/demo-run-job.yml`](./.github/workflows/demo-run-job.yml). It QLoRA-fine-tunes Qwen2.5-0.5B on a GPU, with the adapter landing in the run bucket the job already mounts, deploys a stock vLLM image with that bucket mounted read-only and the LoRA served straight from it (no image build, no registry push), and smoke-tests it — split across five GitHub jobs:

**Submit Training Job** → **Wait** → **Deploy** → **Try**, plus a **Cleanup** job that `needs` all four and runs `if: always()`, so the paid endpoint and the bucket are torn down even when an upstream job fails or the run is cancelled.

---

## License

MIT. See [LICENSE](./LICENSE).
