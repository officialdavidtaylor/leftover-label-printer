# Backend

Node API and job orchestration service boundary.

Use local commands:

- `make install`
- `make lint`
- `make test`
- `make build`
- `npm run backend:start`

Environment setup:

1. Copy `.env.example` to `.env`.
2. Fill in required values listed in `config/required-env.txt`.
3. Keep `OIDC_ROLES_CLAIM=roles` unless a contract-breaking migration is planned across backend and clients.
4. Validate runtime readiness with `node --experimental-strip-types ../scripts/env/validate-env.ts config/required-env.txt .env`.
5. Start the backend service with `npm run backend:start`.

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

Runtime notes:

1. The backend server starts a real HTTP process from `src/server.ts`.
2. On startup it connects to MongoDB, ensures critical indexes, and seeds one demo printer/template when `BACKEND_BOOTSTRAP_DEMO_DATA=true`.
3. Rendered PDFs are uploaded to the configured S3-compatible endpoint and command dispatch publishes to MQTT with QoS 1.
