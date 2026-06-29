# Changelog

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
