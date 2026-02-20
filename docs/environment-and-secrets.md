# Environment and Secret Management Contract

This document defines environment naming conventions, required secret handling, and startup validation expectations for all service boundaries.

## Naming conventions

1. Use uppercase snake case for all environment keys.
2. Prefix service-specific keys (`VITE_`, `BACKEND_`, `AGENT_`) and keep shared dependency names explicit (`MONGO_*`, `MQTT_*`, `S3_*`, `OIDC_*`).
3. Keep `.env.example` files as key names and safe placeholders only. Never commit actual secret values.

## Required key manifests

Each service owns a required-key manifest used by runtime/startup validation:

1. `frontend/config/required-env.txt`
2. `backend/config/required-env.txt`
3. `agent/config/required-env.txt`
4. `infra/config/required-env.txt`

## Startup-time validation expectations

1. Every service should fail fast at startup when any required key is missing or blank.
2. Validation errors must list missing key names only and never log secret values.
3. `scripts/env/validate-env.mjs` is the shared repo-level contract utility for validating required keys.
4. `--keys-only` mode is intended for `.env.example` contract checks where empty values are expected for secrets.
5. Monorepo convention: repo-wide developer and CI utilities are implemented in Node/TypeScript; service-runtime validation is implemented in each service's native language.

## Secret sourcing by environment

| Service | Required keys | Local development source | CI source | Production source |
| --- | --- | --- | --- | --- |
| Frontend | `VITE_API_BASE_URL`, `VITE_OIDC_ISSUER_URL`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_AUDIENCE` | local `.env` copied from `frontend/.env.example`; non-secret config from developer machine | GitHub Actions repository/org variables | deployment environment variables in frontend host |
| Backend | `MONGO_URI`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, OIDC endpoints/audience | local `.env` with secrets injected from local password manager/manual export | GitHub Actions encrypted secrets and variables | managed secret store in runtime platform (inject as env vars) |
| Agent | `MQTT_USERNAME`, `MQTT_PASSWORD`, `BACKEND_API_TOKEN` plus printer/runtime keys | device-local `.env` provisioned during bootstrap | CI secrets for test jobs only (never checked in) | per-device secret store / deployment secret injection |
| Infra | `MONGO_ROOT_PASSWORD`, `EMQX_DASHBOARD_PASSWORD`, `AUTHENTIK_BOOTSTRAP_PASSWORD`, `MINIO_ROOT_PASSWORD` | local `.env` for compose bootstrap (developer-managed) | CI encrypted secrets for infra validation | platform/environment secret manager for deployed infra |

## Day-1 setup pattern

1. Copy each service `.env.example` to `.env` before first run.
2. Populate required secret values from your approved secret source.
3. Validate key contract presence with `node scripts/env/validate-env.mjs --keys-only <service>/config/required-env.txt <service>/.env.example`.
4. Validate runtime-ready env files with `node scripts/env/validate-env.mjs <service>/config/required-env.txt <service>/.env`.
