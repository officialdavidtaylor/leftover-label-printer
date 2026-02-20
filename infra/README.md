# Infra

Local/dev infrastructure and deployment configuration boundary.

Use local commands:

- `make install`
- `make lint`
- `make test`
- `make build`
- `make up`
- `make down`
- `make reset`
- `make ps`
- `make logs`

Environment setup:

1. Copy `.env.example` to `.env`.
2. Fill in required values listed in `config/required-env.txt`.
3. Validate runtime readiness with `node --experimental-strip-types ../scripts/env/validate-env.ts config/required-env.txt .env`.
4. Start local dependencies with `make up` (waits for health checks).

Compose stack definition lives in `docker-compose.yml`.
