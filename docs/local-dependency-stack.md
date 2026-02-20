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

`make -C infra up` runs `docker compose up -d --wait`, which blocks until health checks pass.

## Endpoints

1. MongoDB: `mongodb://localhost:27017`
2. EMQX MQTT: `mqtt://localhost:1883`
3. EMQX dashboard: `http://localhost:18083`
4. MinIO API: `http://localhost:9002`
5. MinIO console: `http://localhost:9003`
6. authentik: `http://localhost:9000`

## Operations

1. Show status: `make -C infra ps`
2. Tail logs: `make -C infra logs`
3. Stop stack: `make -C infra down`
4. Reset stack (remove volumes): `make -C infra reset`

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
   - Check local listeners on ports `1883`, `18083`, `27017`, `9000`, `9002`, `9003`, `9443`.
   - Update port mappings in `infra/docker-compose.yml` if needed.
4. Clean-slate debugging:
   - Run `make -C infra reset`.
   - Recreate with `make -C infra up`.
