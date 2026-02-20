# Local Dependency Stack (Docker Compose)

This stack provides local dependencies required by the architecture:

1. MongoDB
2. EMQX
3. MinIO
4. authentik

Supporting services for authentik (`postgres`, `redis`) are included in the same compose file.

## Prerequisites

1. Docker Desktop (or Docker Engine with Compose plugin)
2. `infra/.env` copied from `infra/.env.example`

## Bootstrap

1. `cp infra/.env.example infra/.env`
2. `make -C infra up`

`make -C infra up` runs `docker compose up -d --wait`, then provisions EMQX backend/agent MQTT users from `infra/.env`.

## Endpoints

1. MongoDB: `mongodb://localhost:27017`
2. EMQX MQTT: `mqtt://localhost:1883`
3. EMQX MQTT over TLS: `mqtts://localhost:8883` (enabled when `EMQX_REQUIRE_TLS=true`)
4. EMQX dashboard: `http://localhost:18083`
5. MinIO API: `http://localhost:9002`
6. MinIO console: `http://localhost:9003`
7. authentik: `http://localhost:9000`

## Operations

1. Show status: `make -C infra ps`
2. Tail logs: `make -C infra logs`
3. Re-run MQTT user bootstrap: `make -C infra bootstrap-auth`
4. Stop stack: `make -C infra down`
5. Reset stack (remove volumes): `make -C infra reset`

## TLS behavior

1. Local default is plaintext MQTT (`1883`) with `EMQX_REQUIRE_TLS=false`.
2. For non-local environments, set `EMQX_DEPLOYMENT_ENV` to a non-`local` value; infra guardrails enforce `EMQX_REQUIRE_TLS=true` and `EMQX_ENABLE_PLAIN_MQTT=false`.
3. When TLS is enabled, place cert files in `infra/emqx/certs` (see `infra/emqx/certs/README.md`).

## Deterministic reset path

`make -C infra reset` performs `docker compose down -v --remove-orphans` and removes all local dependency state.

## Troubleshooting

1. Stack won't start:
   - Run `make -C infra lint` to validate compose configuration.
   - Run `make -C infra logs` and inspect failing service logs.
2. Service is unhealthy:
   - Run `make -C infra ps` and check `STATE`/`HEALTH`.
   - Restart with `make -C infra down && make -C infra up`.
3. Port conflicts:
   - Check local listeners on ports `1883`, `8883`, `18083`, `27017`, `9000`, `9002`, `9003`, `9443`.
   - Update port mappings in `infra/docker-compose.yml` if needed.
4. Clean-slate debugging:
   - Run `make -C infra reset`.
   - Recreate with `make -C infra up`.
