# Changelog

## [0.1.3](https://github.com/piotrjanik/nebius-actions/compare/v0.1.2...v0.1.3) (2026-07-01)


### Features

* **check-object:** verify objects exist under a bucket prefix ([480a1cf](https://github.com/piotrjanik/nebius-actions/commit/480a1cfc8f33ea6e8698c77d0a10cf85f5208b92))
* **core:** add parseSizeBytes for disk-size mapping ([164441c](https://github.com/piotrjanik/nebius-actions/commit/164441cc71978baed52e7b9cfc32835651468d1c))
* **create-bucket:** bucket control-plane wrappers and action ([5724317](https://github.com/piotrjanik/nebius-actions/commit/5724317871e3cdb8dc900d95fc86c46e12db342f))
* **delete-bucket:** empty over S3 then delete bucket ([cda20af](https://github.com/piotrjanik/nebius-actions/commit/cda20af73eb40d8ecebc3ea4faf73011fe84f3eb))
* **jobs:** action inputs for SDK create (args/disk-size/disk-type/preemptible) ([bfacae5](https://github.com/piotrjanik/nebius-actions/commit/bfacae5c59e2d835a72b6221ff844c6d669ff9d6))
* **jobs:** add SDK-based job creation (jobs-sdk) ([b139264](https://github.com/piotrjanik/nebius-actions/commit/b139264665448f73e524dc1e2f5da6a249675d3c))
* **jobs:** create jobs via SDK in submit-job and run-job ([e217b2a](https://github.com/piotrjanik/nebius-actions/commit/e217b2a26fc9bedcc3eb74bafa4d79e62d56a438))
* **jobs:** map disk-size/disk-type/preemptible/args inputs; drop extra-args ([4311a61](https://github.com/piotrjanik/nebius-actions/commit/4311a61603a999864e66d8563e4a96dbd406aa53))
* **sdk:** add jobService client helper ([1b364e0](https://github.com/piotrjanik/nebius-actions/commit/1b364e02cf4334ac3a89e437883fe4bc33a0998d))
* **setup:** export project-id/service-account-id as job-wide defaults ([7dea672](https://github.com/piotrjanik/nebius-actions/commit/7dea672912185bf1e783d2345f41e42eef208aa8))
* **storage:** S3 list/delete helpers and S3Location type ([8d9f1f6](https://github.com/piotrjanik/nebius-actions/commit/8d9f1f63c77ac37a7a127f44ee3363bbdf28e63a))
* **upload-object:** upload a file to a Nebius bucket via SA-minted S3 key ([1dfb032](https://github.com/piotrjanik/nebius-actions/commit/1dfb0323f6d83d868217e5f74b9bc59742995dcc))


### Bug Fixes

* **cli:** ensure `--format json` is placed before `--args` flag ([a87d4b3](https://github.com/piotrjanik/nebius-actions/commit/a87d4b30c554301f0162713862449eac260ade8c))
* **core:** type-safe unit lookup in parseSizeBytes (strict index access) ([2cf1758](https://github.com/piotrjanik/nebius-actions/commit/2cf1758603ac9d3ebac6c535b68285577577a69c))
* **jobs:** resolve subnet for SDK job create ([d7089a8](https://github.com/piotrjanik/nebius-actions/commit/d7089a8e584c8b0e3ce9176e7b03f74cea162e85))
* regenerate committed dist bundles ([a643373](https://github.com/piotrjanik/nebius-actions/commit/a6433734db669726ea502bcc2aa451055bef3695))
* **run-job:** mount demo bucket by id, not via s3:// profile@secret ([1f6edcb](https://github.com/piotrjanik/nebius-actions/commit/1f6edcbdda8787e1545175aaca2f0778ca8f03e7))
* **storage:** resolve mystery_box secret via MysteryBox payload ([f4847db](https://github.com/piotrjanik/nebius-actions/commit/f4847dbb3337040ee2e0de798c0191945977c864))


### Code Refactoring

* **jobs:** close SDK after job create; fix stale docs + test gaps ([3de1139](https://github.com/piotrjanik/nebius-actions/commit/3de113908875f0e954364c6ec1ad2a5313656537))
* **jobs:** remove dead CLI job-create path ([75455dd](https://github.com/piotrjanik/nebius-actions/commit/75455dd8e3af8d287574e58ede55a5946498e723))

## [0.1.2](https://github.com/piotrjanik/nebius-actions/compare/v0.1.1...v0.1.2) (2026-06-29)


### Features

* **auth:** add service-account key auth method; demos use it ([229a9d9](https://github.com/piotrjanik/nebius-actions/commit/229a9d9a9202c2c3693f93e45cc167ce6cbd4245))
* **setup:** configure key-based CLI profile in the setup action ([61b2cc9](https://github.com/piotrjanik/nebius-actions/commit/61b2cc911f1beda81c7147d674f4f0996bd9f890))


### Bug Fixes

* **demo-run-job:** configure key-based nebius CLI profile ([11839e8](https://github.com/piotrjanik/nebius-actions/commit/11839e8a02090d7e962a529313b3c718ba3a6bb4))

## [0.1.1](https://github.com/piotrjanik/nebius-actions/compare/v0.1.0...v0.1.1) (2026-06-29)


### Bug Fixes

* **jobs:** use real CLI flags for job create (--parent-id, --volume) ([80f7dd6](https://github.com/piotrjanik/nebius-actions/commit/80f7dd69d4bea1cb01449d11b80eeca15ef298d7))

## 0.1.0 (2026-06-29)


### ⚠ BREAKING CHANGES

* **endpoints:** deploy-endpoint drops the `auth`, `min-replicas`, `max-replicas`, and `extra-args` inputs and the `token` output; delete-endpoint adds a `project-id` input required when deleting by name.
* **setup,auth:** the setup action no longer authenticates. Workflows must add a separate auth step; the auth inputs and expires-in output moved from setup to the new auth action.
* **auth:** the setup action's `token-exchange-url` input is replaced by a required `service-account-id` input (plus an optional `domain`).

### Features

* add Nebius GitHub Actions suite for jobs and endpoints ([c981f61](https://github.com/piotrjanik/nebius-actions/commit/c981f61b83c903c360ad3a4625488a9624f55fc1))
* **auth:** use @nebius/js-sdk for keyless OIDC exchange ([efcf09b](https://github.com/piotrjanik/nebius-actions/commit/efcf09b02782748e08be7bbb6821dd8f3aa7932e))
* **setup,auth:** split setup into setup (CLI install) and auth (OIDC) ([f408715](https://github.com/piotrjanik/nebius-actions/commit/f408715dbfd31f9234762086256520e45b8a55fa))


### Bug Fixes

* **auth:** use id_token subject_token_type for GitHub OIDC tokens ([d36c914](https://github.com/piotrjanik/nebius-actions/commit/d36c914a7f22b0bd1f53f656c118bbd82b3baa90))
* **build:** make install and dist-drift deterministic across platforms ([bab8f30](https://github.com/piotrjanik/nebius-actions/commit/bab8f30494e4b1163030be89371e5c6db53c3247))
* **deploy-endpoint:** align args with the real nebius CLI v0.12.x ([d13ce44](https://github.com/piotrjanik/nebius-actions/commit/d13ce44a6dd53815004ccce9dadfb47d32f3f4e9))


### Code Refactoring

* **endpoints:** migrate from CLI to @nebius/js-sdk EndpointService ([d2de721](https://github.com/piotrjanik/nebius-actions/commit/d2de7213550a62d0e1618feccc6f5c73521cee8c))


### Reverts

* "fix(auth): use id_token subject_token_type for GitHub OIDC tokens" ([4ef32cc](https://github.com/piotrjanik/nebius-actions/commit/4ef32cc693094c3ef9ac0a8d6f92c5542d1e4a8d))


### Miscellaneous

* bootstrap first release as 0.1.0 ([aef858d](https://github.com/piotrjanik/nebius-actions/commit/aef858d2ada93e46dafdfc67d2f2944428445165))
