# Pi Hardware Loop

Use this runbook from repo root.

## Defaults

1. `PI_E2E_SSH_HOST=label-printer-01`
2. `PI_E2E_CUPS_PRINTER_NAME=dymo`
3. `PI_E2E_TIMEOUT_SECONDS=120`
4. `DEV_PRINTER_ID=printer-01`
5. `DEV_TEMPLATE_ID=label-default`
6. `DEV_TEMPLATE_VERSION=v1`

## 1. Resolve the LAN host

If the user already gave the correct LAN IP, export it directly:

```bash
export PI_E2E_LOCAL_HOST="$(ipconfig getifaddr en0)"
printf 'pi-e2e local host: %s\n' "$PI_E2E_LOCAL_HOST"
```

If not, prefer the interface on the same subnet as the SSH host:

```bash
export PI_E2E_SSH_HOST="${PI_E2E_SSH_HOST:-label-printer-01}"
export PI_E2E_LOCAL_HOST="${PI_E2E_LOCAL_HOST:-$(ipconfig getifaddr en0)}"
ssh -G "$PI_E2E_SSH_HOST" | awk '/^hostname /{print $2; exit}'
printf 'pi-e2e local host: %s\n' "$PI_E2E_LOCAL_HOST"
```

Expected evidence:

1. `PI_E2E_LOCAL_HOST` is a private IPv4 that the Pi can reach.
2. The SSH-resolved host is on the same LAN subnet unless the user says otherwise.

## 2. Create the temporary backend override

```bash
OVERRIDE_DIR="$(mktemp -d)"
OVERRIDE_FILE="$OVERRIDE_DIR/docker-compose.pi-e2e.override.yml"
cat >"$OVERRIDE_FILE" <<EOF
services:
  backend:
    environment:
      S3_ENDPOINT: http://${PI_E2E_LOCAL_HOST}:9002
EOF
printf 'override: %s\n' "$OVERRIDE_FILE"
```

Expected evidence:

1. The override file exists.
2. It rewires backend `S3_ENDPOINT` to `http://<lan-ip>:9002`.

## 3. Start local services without the mock agent

```bash
make -C infra validate-security
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d --wait mongodb emqx minio keycloak
node --experimental-strip-types infra/scripts/bootstrap-emqx-auth.ts infra/.env
node --experimental-strip-types infra/scripts/bootstrap-local-dev.ts infra/.env
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml -f "$OVERRIDE_FILE" up -d --build --force-recreate --wait backend
curl -fsS http://localhost:8080/healthz
```

Expected evidence:

1. EMQX security validation passes.
2. `mongodb`, `emqx`, `minio`, `keycloak`, and `backend` become healthy.
3. `curl` returns backend health JSON with `status":"ok"`.

## 4. Build the Pi agent binary

```bash
make -C agent install
(
  cd agent
  GOTOOLCHAIN=local \
  GOCACHE="$PWD/.cache/go-build" \
  GOMODCACHE="$PWD/.cache/go-mod" \
  CGO_ENABLED=0 \
  GOOS=linux \
  GOARCH=arm64 \
  go build -trimpath -buildvcs=false -ldflags "-s -w -buildid=" -o bin/leftover-agent-linux-arm64 ./cmd/agent
)
```

Expected evidence:

1. `agent/bin/leftover-agent-linux-arm64` exists.
2. The build completes without Go toolchain errors.

## 5. Run Pi preflight checks

```bash
export PI_E2E_CUPS_PRINTER_NAME="${PI_E2E_CUPS_PRINTER_NAME:-dymo}"
ssh -o IdentitiesOnly=no "$PI_E2E_SSH_HOST" "set -eu; \
  lpstat -p '$PI_E2E_CUPS_PRINTER_NAME' >/dev/null; \
  curl -fsS 'http://${PI_E2E_LOCAL_HOST}:8080/healthz' >/dev/null; \
  curl -fsS 'http://${PI_E2E_LOCAL_HOST}:9002/minio/health/live' >/dev/null; \
  nc -z '${PI_E2E_LOCAL_HOST}' 1883; \
  printf 'remote-connectivity-ok\n'"
```

Expected evidence:

1. The command prints `remote-connectivity-ok`.
2. No SSH auth, CUPS, backend, MinIO, or MQTT error appears.

## 6. Copy and validate the remote agent

```bash
ssh -o IdentitiesOnly=no "$PI_E2E_SSH_HOST" "mkdir -p ~/leftover-agent-e2e/spool"
scp -o IdentitiesOnly=no agent/bin/leftover-agent-linux-arm64 "$PI_E2E_SSH_HOST":~/leftover-agent-e2e/leftover-agent
ssh -o IdentitiesOnly=no "$PI_E2E_SSH_HOST" "set -eu; \
  chmod +x ~/leftover-agent-e2e/leftover-agent; \
  env \
    AGENT_PRINTER_ID=printer-01 \
    AGENT_POLL_INTERVAL_SECONDS=1 \
    AGENT_SPOOL_DIR=\$HOME/leftover-agent-e2e/spool \
    CUPS_PRINTER_NAME='$PI_E2E_CUPS_PRINTER_NAME' \
    LP_COMMAND_PATH=/usr/bin/lp \
    MQTT_BROKER_URL='mqtt://${PI_E2E_LOCAL_HOST}:1883' \
    MQTT_CLIENT_ID=printer-01 \
    MQTT_USERNAME=printer-01 \
    MQTT_PASSWORD=change-me-agent \
    AGENT_RETRY_MAX_ATTEMPTS=5 \
    AGENT_RETRY_INITIAL_DELAY_SECONDS=5 \
    AGENT_RETRY_MAX_DELAY_SECONDS=60 \
    AGENT_RETRY_MULTIPLIER=2 \
    BACKEND_BASE_URL='http://${PI_E2E_LOCAL_HOST}:8080' \
    BACKEND_API_TOKEN=pi-e2e-not-used \
    AGENT_VALIDATE_ONLY=true \
    ~/leftover-agent-e2e/leftover-agent"
```

Expected evidence:

1. `scp` completes successfully.
2. Validate-only startup exits successfully without runtime config errors.

## 7. Start the remote agent

```bash
ssh -o IdentitiesOnly=no "$PI_E2E_SSH_HOST" "set -eu; \
  rm -f ~/leftover-agent-e2e/agent.log ~/leftover-agent-e2e/agent.pid; \
  nohup env \
    AGENT_PRINTER_ID=printer-01 \
    AGENT_POLL_INTERVAL_SECONDS=1 \
    AGENT_SPOOL_DIR=\$HOME/leftover-agent-e2e/spool \
    CUPS_PRINTER_NAME='$PI_E2E_CUPS_PRINTER_NAME' \
    LP_COMMAND_PATH=/usr/bin/lp \
    MQTT_BROKER_URL='mqtt://${PI_E2E_LOCAL_HOST}:1883' \
    MQTT_CLIENT_ID=printer-01 \
    MQTT_USERNAME=printer-01 \
    MQTT_PASSWORD=change-me-agent \
    AGENT_RETRY_MAX_ATTEMPTS=5 \
    AGENT_RETRY_INITIAL_DELAY_SECONDS=5 \
    AGENT_RETRY_MAX_DELAY_SECONDS=60 \
    AGENT_RETRY_MULTIPLIER=2 \
    BACKEND_BASE_URL='http://${PI_E2E_LOCAL_HOST}:8080' \
    BACKEND_API_TOKEN=pi-e2e-not-used \
    AGENT_VALIDATE_ONLY=false \
    ~/leftover-agent-e2e/leftover-agent >~/leftover-agent-e2e/agent.log 2>&1 </dev/null & \
  echo \$! > ~/leftover-agent-e2e/agent.pid; \
  sleep 2; \
  tail -n 40 ~/leftover-agent-e2e/agent.log"
```

Expected evidence:

1. The log contains `mqtt_consumer_subscribed`.
2. The topic includes `printers/printer-01/jobs`.

## 8. Submit the live print and wait

```bash
TOKEN="$(make -C infra dev-token | tail -n 1)"
node --experimental-strip-types .codex/skills/leftover-label-printer-pi-e2e/scripts/submit_and_wait.ts \
  --backend-base-url=http://localhost:8080 \
  --token="$TOKEN" \
  --printer-id=printer-01 \
  --template-id=label-default \
  --template-version=v1 \
  --timeout-seconds="${PI_E2E_TIMEOUT_SECONDS:-120}" \
  --item-name='Pi E2E Smoke'
ssh -o IdentitiesOnly=no "$PI_E2E_SSH_HOST" "tail -n 80 ~/leftover-agent-e2e/agent.log"
```

Expected evidence:

1. The helper prints `jobId=...`, `terminalState=printed`, and `backendTraceId=...`.
2. The Pi log tail contains `queue_job_printed`.
3. The Pi log tail contains `lpOutput:request id is ...`.

## 9. Cleanup

Default cleanup:

```bash
ssh -o IdentitiesOnly=no "$PI_E2E_SSH_HOST" "set -eu; \
  if [ -f ~/leftover-agent-e2e/agent.pid ]; then kill \"\$(cat ~/leftover-agent-e2e/agent.pid)\" 2>/dev/null || true; fi; \
  rm -f ~/leftover-agent-e2e/agent.pid"
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml -f "$OVERRIDE_FILE" down --remove-orphans
rm -rf "$OVERRIDE_DIR"
```

Keep things running only when the user asks for it.
