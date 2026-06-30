# submit-job (and run-job create) on the SDK

**Date:** 2026-06-30
**Status:** Approved (design)

## Goal

Move job **creation** from the `nebius` CLI (`nebius ai job create`) to the
official `@nebius/js-sdk` `JobService.create` gRPC call. The change covers the
shared create path used by both the `submit-job` (low-level) and `run-job`
(convenience) entrypoints. Polling, log streaming, and cancellation stay on the
CLI for now.

## Motivation

Job creation currently shells out to the CLI and relies on `extra-args` raw
flag passthrough plus fragile `--args`/`--format json` ordering hacks (see the
demo workflow). The SDK gives a typed, structured request with no quoting
games, and matches the pattern the endpoints actions already use
(`src/core/endpoints/endpoints.ts`).

## Decisions (from brainstorming)

1. **Auth: require the `auth` action.** The SDK reads `NEBIUS_IAM_TOKEN`
   (exported by `auth`), not the `setup` CLI key-profile. The demo workflow
   gains an `auth` step (key method). `setup` remains for the CLI-backed steps
   (bucket ops, `wait-for-job` log streaming).
2. **Input surface: demo-needs only.** Map the existing inputs and add
   `disk-size`, `disk-type`, `preemptible`, and `args`. **Remove `extra-args`.**
   Other `JobSpec` fields (ports, public-ip, ssh keys, working-dir, shm-size,
   injected files, registry credentials) are intentionally not exposed yet.
3. **Scope: both entrypoints.** The shared create path moves to the SDK, so
   `submit-job` and `run-job` stay on one code path. `run-job`'s polling and log
   streaming remain CLI-backed.

## Architecture

Mirror the endpoints domain. New module **`src/core/jobs/jobs-sdk.ts`** holds:

- `JobServiceLike` — the narrow injected interface (so the I/O function is unit
  testable with a fake; no SDK construction in tests).
- `buildJobMetadata(spec)` and `buildJobSpec(spec)` — **pure** builders that map
  the domain `JobSpec` onto SDK partials.
- `buildCreateJobRequest(spec)` — pure; assembles `CreateJobRequest`.
- `createJobViaSdk(service, spec)` — the one I/O function. Create returns an
  operation, not a job; only `op.resourceId()` is read (see Return semantics),
  so no SDK→`Job` mapper is needed here (the get path stays on the CLI).

`src/core/sdk/client.ts` gains `jobService(sdk)` alongside `endpointService(sdk)`
(same single-cast boundary).

The existing **`src/core/jobs/jobs.ts`** keeps `getJob`, `cancelJob`,
`streamJobLogs`, `isJobTerminal`, `isJobSuccess`, `mapJobJson` (still used by the
CLI get/cancel path). The CLI-create helpers `buildCreateJobArgs` and `createJob`
become dead once both entrypoints switch and are **removed** in this change
(with their tests). `wait-for-job`, `cancel-job` are unchanged.

The domain `JobSpec` / `Job` interfaces (in `jobs.ts`) are extended with the new
fields and shared by both modules.

### File layout

```
src/core/jobs/
  jobs.ts        # CLI: get/cancel/logs/status helpers + shared JobSpec/Job types
  jobs-sdk.ts    # NEW: JobServiceLike, pure builders, mapSdkJob, createJobViaSdk
  inputs.ts      # buildJobSpecFromInputs — new inputs, drops extra-args
  index.ts       # re-exports
src/core/sdk/
  client.ts      # + jobService(sdk)
```

## Input → JobSpec mapping

Domain `JobSpec` (extended):

```ts
export interface JobSpec {
  name?: string;
  image: string;
  command?: string[];     // -> containerCommand (joined with ' ')
  args?: string;          // NEW -> args (single string)
  preset?: string;
  platform?: string;
  env?: Record<string, string>;  // -> environmentVariables[]
  mounts?: string[];      // '<source>:/path:rw' -> volumes[]
  timeout?: string;       // '1h' -> Duration
  diskSizeBytes?: number; // NEW (parsed from disk-size)
  diskType?: string;      // NEW -> DiskSpec_DiskType member
  preemptible?: boolean;  // NEW
  projectId?: string;     // -> metadata.parentId
}
```

| Action input | Domain field | SDK `JobSpec` field |
|---|---|---|
| `image` (required) | `image` | `image` |
| `name` | `name` | `metadata.name` |
| `command` (multiline) | `command` | `containerCommand` (joined) |
| `args` *(NEW)* | `args` | `args` |
| `preset` | `preset` | `preset` |
| `platform` | `platform` | `platform` |
| `env` (KEY=VALUE) | `env` | `environmentVariables[] {name,value}` |
| `mounts` (`<id>:/path:rw`) | `mounts` | `volumes[] {source, containerPath, mode}` |
| `timeout` (`1h`) | `timeout` | `timeout` (dayjs `Duration`) |
| `disk-size` *(NEW, `250Gi`)* | `diskSizeBytes` | `disk.sizeBytes` |
| `disk-type` *(NEW, default `network-ssd`)* | `diskType` | `disk.type` |
| `preemptible` *(NEW, bool)* | `preemptible` | `preemptible` |
| `project-id` | `projectId` | `metadata.parentId` |

Removed: **`extra-args`**, and the CLI-only `--format json` handling.

### Field construction details (verified against @nebius/js-sdk 0.2.27)

- **Builders use the proto `.create()` factories** with `DeepPartial` partials,
  exactly like `SdkEndpointSpec.create(buildEndpointSpec(s))`.
- **`sizeBytes` is a `Long`**, but `DeepPartial<Long>` accepts `string | number`,
  so `disk.sizeBytes` is set to a plain `number` (bytes).
- **`timeout` is `Duration = ReturnType<typeof dayjs.duration>`.** Build via the
  SDK-re-exported `dayjs`: `dayjs.duration(parseDurationMs(s))`. (`dayjs` and
  `Long` come from `@nebius/js-sdk/runtime/protos/index`, already mapped in
  `tsconfig.json` paths.)
- **Enums are referenced as members**, not raw strings:
  - `mode`: `JobSpec_VolumeMount_Mode.READ_WRITE` (for `:rw`, default) /
    `.READ_ONLY` (for `:ro`).
  - `disk.type`: `DiskSpec_DiskType.NETWORK_SSD` (default), mapping the
    `disk-type` input (`network-ssd`/`network-hdd`/…) to the matching member;
    unknown values throw (no silent fallback).
- **`disk` is only set when `diskSizeBytes` is present**; when set, BOTH
  `sizeBytes` and `type` are provided (type is a required enum on the proto).

### Mount string parsing

`<source>:<containerPath>[:<mode>]` — split into at most 3 parts on `:`. The
mode suffix (`rw`/`ro`) is optional and defaults to `rw` → `READ_WRITE`. A
malformed mount (missing source or path) throws. New helper
`parseMount(s): { source, containerPath, mode }`.

### Size parsing

New helper `parseSizeBytes(s: string): number` accepting `Ki/Mi/Gi/Ti`
(binary) and plain byte counts (`250Gi`, `1073741824`). Throws on an
unparseable value (no silent default). Lives next to `parseDurationMs`
(`src/core/time.ts`) or a new `src/core/size.ts`.

## Return semantics

`service.create(req).result` resolves to an `OperationLike` whose
`resourceId()` is the new job id. Following the endpoints precedent, **no
follow-up `get`** is issued:

```ts
return { id: op.resourceId(), status: 'CREATING', raw: op.raw?.() ?? op };
```

`'CREATING'` is added to `JOB_STATUS` as the initial, non-terminal status.
Entrypoints output `job-id` and `status` unchanged. `wait-for-job` polls the
real state via the CLI (`nebius ai job get`), which accepts the same resource
id. The container exit code still surfaces from `wait-for-job`, unaffected.

## Entrypoint changes

- `src/entrypoints/submit-job.ts`: drop `ensureCli`; construct the SDK
  (`createSdk()` + `jobService`) and call `createJobViaSdk`. Wrap in the same
  `log.group('Create job', …)`.
- `src/entrypoints/run-job.ts`: same swap for the create step; keep the existing
  CLI poll + `streamJobLogs` afterward.

## action.yml changes

`actions/submit-job/action.yml` and `actions/run-job/action.yml`:

- Remove `extra-args`.
- Add `args`, `disk-size`, `disk-type` (default `network-ssd`), `preemptible`
  (default `false`).
- Note in the action description that `auth` must run first (SDK token).

## Demo workflow changes

`.github/workflows/demo-run-job.yml`:

- Add an `auth` step (key method) after `setup`, before the job is submitted, so
  `NEBIUS_IAM_TOKEN` is exported.
- Replace the `extra-args` block on the submit step with `disk-size: 250Gi`,
  `preemptible: true`, and `args: '-c "axolotl train /workspace/data/config.yaml"'`.
- `command: bash` stays (entrypoint); `args` carries the script.

## Testing

New `__tests__/jobs/jobs-sdk.test.ts`, mirroring `endpoints.test.ts`:

- `buildJobSpec` / `buildCreateJobRequest` (pure): env list, mounts→volumes incl.
  `rw`/`ro`→mode enum, disk set only when size present, disk-type mapping +
  unknown-throws, timeout→duration, preemptible, containerCommand join, args.
- `parseMount` and `parseSizeBytes` edge cases (defaults, malformed → throw).
- `createJobViaSdk` against a fake `JobServiceLike` returning a stub operation:
  asserts `id` = `resourceId()` and `status` = `CREATING`.

Existing `jobs.test.ts` stays, minus the `buildCreateJobArgs`/`createJob` (CLI
create) tests, which are removed with the code they cover.

## Risks / open items

- **`disk.type` enum spelling** confirmed as `DiskSpec_DiskType` with members
  `UNSPECIFIED | NETWORK_SSD | NETWORK_HDD | NETWORK_SSD_NON_REPLICATED |
  NETWORK_SSD_IO_M3`. Default input `network-ssd`.
- **Auth in the demo** now needs both `setup` (CLI for bucket/log steps) and
  `auth` (SDK token). Both use the same SA key already in secrets.
- **CLI-create removal**: `buildCreateJobArgs`/`createJob` in `jobs.ts` become
  unused once both entrypoints switch. Remove them and their tests in the same
  change to avoid dead code, keeping `getJob`/`cancelJob`/`streamJobLogs`.

## Out of scope

- Migrating `get`/`cancel`/`logs`/poll to the SDK.
- Full `JobSpec` proto coverage (ports, public-ip, ssh keys, working-dir,
  shm-size, injected files, registry credentials).
- A JSON spec-override escape hatch.
