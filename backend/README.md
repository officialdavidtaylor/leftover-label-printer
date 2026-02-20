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

Template renderer contract (`label-default@v1`):

1. PDF page size is 1" x 2.125" (`153 x 72` points) for Dymo LabelWriter 450 compatibility.
2. Template payload fields are `itemName` and `datePrepared` (`YYYY-MM-DD`).
3. Quantity is print dispatch metadata and is not rendered on the label PDF.

Interface contracts:

1. HTTP API contract: `../contracts/openapi.yaml`.
2. MQTT backend-agent contract: `../contracts/asyncapi.yaml`.
3. MQTT versioning policy: `../docs/asyncapi-versioning-policy.md`.
