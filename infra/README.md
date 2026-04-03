# Infra

Local/dev infrastructure and deployment configuration boundary.

Use local commands:

- `make install`
- `make lint`
- `make test`
- `make build`
- `make up`
- `make up-dev`
- `make down`
- `make down-dev`
- `make reset`
- `make reset-dev`
- `make ps`
- `make ps-dev`
- `make logs`
- `make logs-dev`
- `make validate-security`
- `make bootstrap-auth`
- `make bootstrap-dev`
- `make dev-token`
- `make smoke-dev`
- `make smoke-dev-failed`

Environment setup:

1. Copy `.env.example` to `.env`.
2. Fill in required values listed in `config/required-env.txt`.
3. Validate runtime readiness with `node --experimental-strip-types ../scripts/env/validate-env.ts config/required-env.txt .env`.
4. Validate EMQX TLS guardrails with `make validate-security`.
5. Start local dependencies with `make up` (waits for health checks and then provisions EMQX MQTT users).
6. Point the backend at the local single-node replica set with `MONGO_URI=mongodb://admin:changeme@localhost:27017/?authSource=admin&replicaSet=rs0` unless you have customized the compose credentials.
7. Start the all-local backend, frontend, and mock-agent loop with `make up-dev`.
8. Mint a backend-compatible local access token with `make dev-token`.
9. Run a terminal-state smoke check with `make smoke-dev` or `make smoke-dev-failed`.

Compose stack definitions live in `docker-compose.yml` and `docker-compose.dev.yml`.
