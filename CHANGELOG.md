# Changelog

## [0.1.0](https://github.com/piotrjanik/nebius-actions/compare/v0.1.2...v0.1.0) (2026-07-14)


### ⚠ BREAKING CHANGES

* the run-job, download-object and check-object actions are removed. Consumers of run-job should use submit-job followed by wait-for-job.
* **endpoints:** deploy-endpoint drops the `auth`, `min-replicas`, `max-replicas`, and `extra-args` inputs and the `token` output; delete-endpoint adds a `project-id` input required when deleting by name.
* **setup,auth:** the setup action no longer authenticates. Workflows must add a separate auth step; the auth inputs and expires-in output moved from setup to the new auth action.
* **auth:** the setup action's `token-exchange-url` input is replaced by a required `service-account-id` input (plus an optional `domain`).

### Features

* **actions:** add download-object — pull bucket-prefix artifacts onto the runner ([1dd779a](https://github.com/piotrjanik/nebius-actions/commit/1dd779aa056e5ca395df3e16dbd2eca09ce25943))
* add Nebius GitHub Actions suite for jobs and endpoints ([c981f61](https://github.com/piotrjanik/nebius-actions/commit/c981f61b83c903c360ad3a4625488a9624f55fc1))
* **auth:** add service-account key auth method; demos use it ([e48d0b2](https://github.com/piotrjanik/nebius-actions/commit/e48d0b2bc5ee285a6d750d867aa19df053b40b9f))
* **auth:** use @nebius/js-sdk for keyless OIDC exchange ([efcf09b](https://github.com/piotrjanik/nebius-actions/commit/efcf09b02782748e08be7bbb6821dd8f3aa7932e))
* **check-object:** verify objects exist under a bucket prefix ([8e9fbd1](https://github.com/piotrjanik/nebius-actions/commit/8e9fbd1c57cdd0cfee61146d1aba47397f3822f7))
* **core:** add parseSizeBytes for disk-size mapping ([03f3f36](https://github.com/piotrjanik/nebius-actions/commit/03f3f367f98347424e389862a47f1c1bc9c18a07))
* **create-bucket:** bucket control-plane wrappers and action ([52d1214](https://github.com/piotrjanik/nebius-actions/commit/52d121430fd61f702ce713a01d2e76011bc8f0b8))
* **delete-bucket:** empty over S3 then delete bucket ([71d3b85](https://github.com/piotrjanik/nebius-actions/commit/71d3b85642d32dacfbaec014cc695af747f7ed5d))
* **deploy-endpoint:** pass platform/disk/subnet/protocol/parent and auto-resolve subnet ([327e82f](https://github.com/piotrjanik/nebius-actions/commit/327e82ff7d502c7cd028021f6c37dbca6ae2b908))
* drop run-job, download-object and check-object actions ([444da59](https://github.com/piotrjanik/nebius-actions/commit/444da594259c78810433e98ec9b3a3daf8e331b8))
* **endpoints:** emit port protocol, disk, and subnet in the endpoint spec ([656de92](https://github.com/piotrjanik/nebius-actions/commit/656de929f631c2b59cb5a05aee896d0cec38f7d8))
* **endpoints:** support bucket mounts and a command override ([b8de1f3](https://github.com/piotrjanik/nebius-actions/commit/b8de1f3f4cb7d8c3555e37eeb7c9054d8df9e418))
* **examples:** CPU serving image for the fine-tuned demo model ([495ddee](https://github.com/piotrjanik/nebius-actions/commit/495ddee92fdf332a54d56244bc6fe3892338bb7d))
* **jobs:** action inputs for SDK create (args/disk-size/disk-type/preemptible) ([d42b9b7](https://github.com/piotrjanik/nebius-actions/commit/d42b9b7779842fa313d9129cf78c09acf0a62664))
* **jobs:** add SDK-based job creation (jobs-sdk) ([d8e5389](https://github.com/piotrjanik/nebius-actions/commit/d8e5389cd363b63ae44f22dbf68b3fb47a3b3d4e))
* **jobs:** create jobs via SDK in submit-job and run-job ([05586ea](https://github.com/piotrjanik/nebius-actions/commit/05586eac5cddb92f6b3f29f0644bebe46d137de3))
* **jobs:** map disk-size/disk-type/preemptible/args inputs; drop extra-args ([3271054](https://github.com/piotrjanik/nebius-actions/commit/3271054dddb4c444bd57b918cd57e959c8bdbf49))
* **sdk:** add jobService client helper ([23fad46](https://github.com/piotrjanik/nebius-actions/commit/23fad46115cb61cf0363b9320a43f72a5d869944))
* **setup,auth:** split setup into setup (CLI install) and auth (OIDC) ([f408715](https://github.com/piotrjanik/nebius-actions/commit/f408715dbfd31f9234762086256520e45b8a55fa))
* **setup:** configure key-based CLI profile in the setup action ([23b4c93](https://github.com/piotrjanik/nebius-actions/commit/23b4c93b823754f35c10db3d4ee330b5dfadc691))
* **setup:** export project-id/service-account-id as job-wide defaults ([68ee3e9](https://github.com/piotrjanik/nebius-actions/commit/68ee3e91c7e91606cc815bfb4fc8ad451d14cada))
* **storage:** download core — list prefix and fetch objects with an ephemeral key ([69588cf](https://github.com/piotrjanik/nebius-actions/commit/69588cffceae4944ca2586c9b14dd39e916419b2))
* **storage:** S3 list/delete helpers and S3Location type ([d8d818c](https://github.com/piotrjanik/nebius-actions/commit/d8d818c5106ee2aa6d7139c26af24d0ee79c2151))
* **upload-object:** upload a file to a Nebius bucket via SA-minted S3 key ([96aa89f](https://github.com/piotrjanik/nebius-actions/commit/96aa89fa03799672c5e647d43c5a7c2758b89e58))


### Bug Fixes

* **auth:** use id_token subject_token_type for GitHub OIDC tokens ([d36c914](https://github.com/piotrjanik/nebius-actions/commit/d36c914a7f22b0bd1f53f656c118bbd82b3baa90))
* **build:** make install and dist-drift deterministic across platforms ([bab8f30](https://github.com/piotrjanik/nebius-actions/commit/bab8f30494e4b1163030be89371e5c6db53c3247))
* **cli:** ensure `--format json` is placed before `--args` flag ([4a25a4f](https://github.com/piotrjanik/nebius-actions/commit/4a25a4f5cef6f40776b567891985bb3834c5d6c7))
* **core:** type-safe unit lookup in parseSizeBytes (strict index access) ([b169988](https://github.com/piotrjanik/nebius-actions/commit/b169988b9f05716b13585952d067a3abe18f1830))
* **demo-run-job:** configure key-based nebius CLI profile ([38c7d72](https://github.com/piotrjanik/nebius-actions/commit/38c7d72a9049e57c31d56cd315b7dc308c62b9a3))
* **demo:** bound and prefetch the job's Hugging Face fetches ([3931b74](https://github.com/piotrjanik/nebius-actions/commit/3931b7480c6790607cb1209e49df36a7128d0441))
* **demo:** build the image path from the registry id without the registry- prefix ([13b4bb1](https://github.com/piotrjanik/nebius-actions/commit/13b4bb10a12fec8ccbffec0abc70af5144e4680e))
* **demo:** keep retrying the Hugging Face prefetch ([da73262](https://github.com/piotrjanik/nebius-actions/commit/da73262b5eb430ebe233067f04788e8ad4e2815f))
* **demo:** pass wait-for-endpoint timeout as seconds, not a duration string ([e66a354](https://github.com/piotrjanik/nebius-actions/commit/e66a354e694b98c60a8d31b1937968c5cba0cb3a))
* **demo:** push/pull the serving image via the registry regional FQDN ([26bcc92](https://github.com/piotrjanik/nebius-actions/commit/26bcc92f0fec25c57818cbc017099e3da84f68df))
* **demo:** retry the crane push against transient registry DNS failures ([073b361](https://github.com/piotrjanik/nebius-actions/commit/073b3616f59104aa54fd68fb95bdf8d8e3f50afd))
* **demo:** self-provision the container registry in demo-run-job ([83f99f0](https://github.com/piotrjanik/nebius-actions/commit/83f99f0ee4a1e7cc4abe4731aff2353d135b9320))
* **demo:** use an endpoint preset that exists on gpu-l40s-a ([aab5408](https://github.com/piotrjanik/nebius-actions/commit/aab5408bb98ca14ce27895f567e88f02595ebdf9))
* **deploy-endpoint:** align args with the real nebius CLI v0.12.x ([d13ce44](https://github.com/piotrjanik/nebius-actions/commit/d13ce44a6dd53815004ccce9dadfb47d32f3f4e9))
* **endpoints:** report a bare public endpoint as http, not https ([1af8904](https://github.com/piotrjanik/nebius-actions/commit/1af89040beceff7f12a73976fb8f8cd73f5f6316))
* **jobs:** escalate to SIGKILL if the log stream ignores SIGTERM ([09ebc75](https://github.com/piotrjanik/nebius-actions/commit/09ebc75ea096f9c7341d859e427d7f960849607f))
* **jobs:** resolve subnet for SDK job create ([ffe1e3c](https://github.com/piotrjanik/nebius-actions/commit/ffe1e3c8862588484084c8b5f78a64826b258e88))
* **jobs:** stop the job log stream once polling ends ([4e8b86b](https://github.com/piotrjanik/nebius-actions/commit/4e8b86b0a0bec9fc5e5285b9d42ffa675562b33c))
* **jobs:** stream job logs with a positional id and --follow ([de61e80](https://github.com/piotrjanik/nebius-actions/commit/de61e800f76fb0e6b27fbfb378136dad30722156))
* **jobs:** use real CLI flags for job create (--parent-id, --volume) ([d920356](https://github.com/piotrjanik/nebius-actions/commit/d920356ace9c58caa3b654bb591deedbe99b93f5))
* regenerate committed dist bundles ([6fadcec](https://github.com/piotrjanik/nebius-actions/commit/6fadcec3b80f8281d7ce383ea9b519d0c0d19d93))
* **run-job:** mount demo bucket by id, not via s3:// profile@secret ([959ded8](https://github.com/piotrjanik/nebius-actions/commit/959ded8fa5dbdd209517ae6720cbc6c9a399e47f))
* **storage:** make ephemeral access-key names unique per invocation ([b465826](https://github.com/piotrjanik/nebius-actions/commit/b4658267be4472b5fb49596cd2db6b518d8a120e))
* **storage:** resolve mystery_box secret via MysteryBox payload ([81cab3d](https://github.com/piotrjanik/nebius-actions/commit/81cab3d820511c7033c1e4d2e0a5a579f5138fac))


### Code Refactoring

* **endpoints:** migrate from CLI to @nebius/js-sdk EndpointService ([d2de721](https://github.com/piotrjanik/nebius-actions/commit/d2de7213550a62d0e1618feccc6f5c73521cee8c))
* **jobs:** close SDK after job create; fix stale docs + test gaps ([08bde68](https://github.com/piotrjanik/nebius-actions/commit/08bde6827d07769422b6f5317ac9c2b2e78a9dbf))
* **jobs:** remove dead CLI job-create path ([0a3fe44](https://github.com/piotrjanik/nebius-actions/commit/0a3fe4455a8c52dc7056aa99d868263eded10e7f))
* **sdk:** extract shared disk-type map to core/sdk/disk ([a751df7](https://github.com/piotrjanik/nebius-actions/commit/a751df7610fd38217106991f567a7ef81de5ee11))


### Reverts

* "fix(auth): use id_token subject_token_type for GitHub OIDC tokens" ([4ef32cc](https://github.com/piotrjanik/nebius-actions/commit/4ef32cc693094c3ef9ac0a8d6f92c5542d1e4a8d))


### Miscellaneous

* bootstrap first release as 0.1.0 ([aef858d](https://github.com/piotrjanik/nebius-actions/commit/aef858d2ada93e46dafdfc67d2f2944428445165))

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
