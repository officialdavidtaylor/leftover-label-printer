# Backend

Node API and job orchestration service boundary.

Use local commands:

- `make install`
- `make lint`
- `make test`
- `make build`

Environment setup:

1. Copy `.env.example` to `.env`.
2. Fill in required values listed in `config/required-env.txt`.
3. Keep `OIDC_ROLES_CLAIM=roles` unless a contract-breaking migration is planned across backend and clients.
4. Validate runtime readiness with `node --experimental-strip-types ../scripts/env/validate-env.ts config/required-env.txt .env`.

Data contracts:

1. Backend data validation uses `zod` schemas in `src/data/schema-contracts.ts`.
2. Canonical sample schema documents are documented in `../docs/data-schemas.md`.

Interface contracts:

1. HTTP API contract: `../contracts/openapi.yaml`.
2. MQTT backend-agent contract: `../contracts/asyncapi.yaml`.
3. MQTT versioning policy: `../docs/asyncapi-versioning-policy.md`.
