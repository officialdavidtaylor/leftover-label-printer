# Local Dependency Stack (Docker Compose)

This stack provides local dependencies required by the architecture:

1. MongoDB
2. EMQX
3. MinIO
4. Keycloak

The dev overlay extends that base stack with:

5. Backend API
6. Mock print agent

## Prerequisites

1. Docker Desktop (or Docker Engine with Compose plugin)
2. `infra/.env` copied from `infra/.env.example`

## Bootstrap

1. `cp infra/.env.example infra/.env`
2. `make -C infra up`
3. Configure the local Keycloak realm/client settings using `docs/keycloak-oidc-setup.md`.

`make -C infra up` runs `docker compose up -d --wait`, then provisions EMQX backend/agent MQTT users from `infra/.env`.

## All-local terminal-state loop

1. `make -C infra up-dev`
2. `make -C infra dev-token`
3. `make -C infra smoke-dev`

`make -C infra up-dev` starts the dependency stack, provisions MQTT users, bootstraps the Keycloak realm/client/user plus the MinIO bucket, then launches the backend and a mock agent in the dev overlay.

`make -C infra dev-token` prints a bearer token whose `iss`, `aud`, `sub`, and top-level `roles` claims match the backend verifier's contract without requiring manual Keycloak setup.

`make -C infra smoke-dev` submits a job through `POST /v1/print-jobs`, polls `GET /v1/print-jobs/{jobId}` until it reaches `printed`, and verifies that a mock artifact was written to `infra/dev-artifacts/<jobId>.pdf`.

For deliberate failure-path verification, run `make -C infra smoke-dev-failed`. The mock agent treats PDFs containing the `DEV_MOCK_PRINT_FAIL_MARKER` text as a controlled failure and the smoke script expects a terminal `failed` state.

## Known limitations

1. The dev overlay uses a mock print agent and mock `lp` command, so it validates backend and MQTT terminal-state handling without covering real CUPS or Raspberry Pi hardware integration.
2. `make -C infra bootstrap-dev`, `make -C infra dev-token`, `make -C infra smoke-dev`, and `make -C infra smoke-dev-failed` should be run sequentially. They all re-use Keycloak's `kcadm.sh` config file, which is lock-backed during bootstrap.

## Endpoints

1. MongoDB: `mongodb://localhost:27017`
2. EMQX MQTT: `mqtt://localhost:1883`
3. EMQX MQTT over TLS: `mqtts://localhost:8883` (enabled when `EMQX_REQUIRE_TLS=true`)
4. EMQX dashboard: `http://localhost:18083`
5. MinIO API: `http://localhost:9002`
6. MinIO console: `http://localhost:9003`
7. Keycloak: `http://localhost:9000`

## Operations

1. Show status: `make -C infra ps`
2. Show dev-overlay status: `make -C infra ps-dev`
3. Tail dependency logs: `make -C infra logs`
4. Tail dev-overlay logs: `make -C infra logs-dev`
5. Re-run MQTT user bootstrap: `make -C infra bootstrap-auth`
6. Re-run Keycloak/MinIO bootstrap: `make -C infra bootstrap-dev`
7. Stop dependency stack: `make -C infra down`
8. Stop dependency stack plus backend/mock-agent: `make -C infra down-dev`
9. Reset dependency stack volumes: `make -C infra reset`
10. Reset dev overlay volumes and mock artifacts: `make -C infra reset-dev`

## TLS behavior

1. Local default is plaintext MQTT (`1883`) with `EMQX_REQUIRE_TLS=false`.
2. For non-local environments, set `EMQX_DEPLOYMENT_ENV` to a non-`local` value; infra guardrails enforce `EMQX_REQUIRE_TLS=true` and `EMQX_ENABLE_PLAIN_MQTT=false`.
3. When TLS is enabled, place cert files in `infra/emqx/certs` (see `infra/emqx/certs/README.md`).

## Deterministic reset path

`make -C infra reset` performs `docker compose down -v --remove-orphans` and removes all local dependency state.

`make -C infra reset-dev` performs the same reset against the base plus dev overlay, including the mock agent spool volume and files under `infra/dev-artifacts/`.

## Troubleshooting

1. Stack won't start:
   - Run `make -C infra lint` to validate compose configuration.
   - Run `make -C infra logs` and inspect failing service logs.
2. Service is unhealthy:
   - Run `make -C infra ps` and check `STATE`/`HEALTH`.
   - Restart with `make -C infra down && make -C infra up`.
3. `make -C infra dev-token` fails:
   - Confirm Keycloak is healthy with `make -C infra ps`.
   - Re-run `make -C infra bootstrap-dev` to recreate the local realm, client, and dev user.
4. `make -C infra smoke-dev` stalls before a terminal state:
   - Auth failure: re-run `make -C infra dev-token` and confirm the backend is up with `curl -s http://localhost:8080/healthz`.
   - Broker wiring: run `make -C infra logs-dev` and look for backend subscription or mock-agent MQTT connection errors.
   - Backend state ingestion: inspect backend logs for `printer_status_consumed` rejects or transition failures.
   - Mock printing: inspect `infra/dev-artifacts/` plus the mock-agent logs for `mock print failed` output.
5. Port conflicts:
   - Check local listeners on ports `1883`, `8883`, `18083`, `27017`, `9000`, `9002`, `9003`.
   - Update port mappings in `infra/docker-compose.yml` if needed.
6. Clean-slate debugging:
   - Run `make -C infra reset-dev`.
   - Recreate with `make -C infra up-dev`.
