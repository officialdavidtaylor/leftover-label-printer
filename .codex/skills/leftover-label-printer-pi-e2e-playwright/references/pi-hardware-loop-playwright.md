# Pi Hardware Loop (Playwright Trigger)

Use this runbook from repo root.

## Defaults

1. `PI_E2E_SSH_HOST=label-printer-01`
2. `PI_E2E_CUPS_PRINTER_NAME=dymo`
3. `PI_E2E_TIMEOUT_SECONDS=120`
4. `PI_E2E_FRONTEND_URL=http://127.0.0.1:4173`
5. `DEV_PRINTER_ID=printer-01`
6. `DEV_TEMPLATE_ID=label-default`
7. `DEV_TEMPLATE_VERSION=v1`

## 1. Resolve the LAN host

Reuse the same LAN host resolution steps as the direct Pi E2E skill:

```bash
export PI_E2E_SSH_HOST="${PI_E2E_SSH_HOST:-label-printer-01}"
export PI_E2E_LOCAL_HOST="${PI_E2E_LOCAL_HOST:-$(ipconfig getifaddr en0)}"
ssh -G "$PI_E2E_SSH_HOST" | awk '/^hostname /{print $2; exit}'
printf 'pi-e2e local host: %s\n' "$PI_E2E_LOCAL_HOST"
```

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

1. The backend health check returns `status":"ok"`.
2. Signed MinIO URLs point at `http://<lan-ip>:9002`.

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

## 5. Run Pi preflight checks

```bash
export PI_E2E_CUPS_PRINTER_NAME="${PI_E2E_CUPS_PRINTER_NAME:-dymo}"
ssh "$PI_E2E_SSH_HOST" "set -eu; \
  lpstat -p '$PI_E2E_CUPS_PRINTER_NAME' >/dev/null; \
  curl -fsS 'http://${PI_E2E_LOCAL_HOST}:8080/healthz' >/dev/null; \
  curl -fsS 'http://${PI_E2E_LOCAL_HOST}:9002/minio/health/live' >/dev/null; \
  nc -z '${PI_E2E_LOCAL_HOST}' 1883; \
  printf 'remote-connectivity-ok\n'"
```

## 6. Copy, validate, and start the remote agent

Use the same validate-only and background startup commands as the direct Pi E2E skill, including:

1. `AGENT_PRINTER_ID=printer-01`
2. `MQTT_BROKER_URL=mqtt://<lan-ip>:1883`
3. `BACKEND_BASE_URL=http://<lan-ip>:8080`
4. logs in `~/leftover-agent-e2e/agent.log`

Expected evidence:

1. The validate-only run exits successfully.
2. The background log contains `mqtt_consumer_subscribed`.

## 7. Start the frontend locally

```bash
npm ci --prefix frontend
FRONTEND_LOG="$(mktemp -t pi-e2e-frontend.XXXXXX.log)"
FRONTEND_PID_FILE="$(mktemp -t pi-e2e-frontend-pid.XXXXXX)"
nohup npm --prefix frontend run dev -- --host 127.0.0.1 --port 4173 >"$FRONTEND_LOG" 2>&1 </dev/null &
echo $! >"$FRONTEND_PID_FILE"
curl -fsS "$PI_E2E_FRONTEND_URL" >/dev/null
printf 'frontend-log: %s\nfrontend-pid-file: %s\n' "$FRONTEND_LOG" "$FRONTEND_PID_FILE"
```

Expected evidence:

1. `curl` succeeds against `http://127.0.0.1:4173`.
2. The frontend log does not show a fatal startup error.

## 8. Mint a dev token and seed the frontend auth session

```bash
TOKEN="$(make -C infra dev-token | tail -n 1)"
printf 'token-ready\n'
```

Use the Playwright MCP to set local storage before opening the creator:

```js
() => {
  localStorage.setItem(
    'leftover-label-printer.auth-session',
    JSON.stringify({
      userId: 'pi-e2e-user',
      accessToken: '<TOKEN>',
      expiresAt: 4102444800,
      roles: ['user'],
      name: 'Pi E2E Operator',
    })
  );
}
```

Replace `<TOKEN>` with the bearer token captured from the shell step.

## 9. Trigger the print through the creator UI

Use the Playwright MCP against `http://127.0.0.1:4173`:

1. Navigate to `/app/print/new`.
2. If redirected to `/login`, seed local storage as above and navigate back to `/app/print/new`.
3. Fill the creator form using the current `data-testid` contract:
   - `item-name-input`
   - `date-prepared-input`
   - `submit-print-button`
4. Submit the form and wait for the acceptance toast.
5. Capture the `jobId` from either:
   - the `toast-status-link` href, or
   - the `/app/jobs/<jobId>` URL after clicking the toast link

Expected evidence:

1. The creator accepts the submission.
2. A toast or status route exposes the accepted `jobId`.

## 10. Wait for terminal backend state

After capturing the `jobId`, poll from shell:

```bash
node --experimental-strip-types .codex/skills/leftover-label-printer-pi-e2e-playwright/scripts/wait_for_terminal.ts \
  --backend-base-url=http://localhost:8080 \
  --token="$TOKEN" \
  --job-id='<JOB_ID>' \
  --timeout-seconds="${PI_E2E_TIMEOUT_SECONDS:-120}"
ssh "$PI_E2E_SSH_HOST" "tail -n 80 ~/leftover-agent-e2e/agent.log"
```

Replace `<JOB_ID>` with the value captured from Playwright.

Expected evidence:

1. The helper prints `jobId=...` and `terminalState=printed`.
2. The Pi log tail contains `queue_job_printed`.
3. The Pi log tail contains `lpOutput:request id is ...`.

## 11. Cleanup

Default cleanup:

```bash
ssh "$PI_E2E_SSH_HOST" "set -eu; \
  if [ -f ~/leftover-agent-e2e/agent.pid ]; then kill \"\$(cat ~/leftover-agent-e2e/agent.pid)\" 2>/dev/null || true; fi; \
  rm -f ~/leftover-agent-e2e/agent.pid"
if [ -f "$FRONTEND_PID_FILE" ]; then kill "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null || true; fi
rm -f "$FRONTEND_PID_FILE" "$FRONTEND_LOG"
docker compose --env-file infra/.env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml -f "$OVERRIDE_FILE" down --remove-orphans
rm -rf "$OVERRIDE_DIR"
```

Keep things running only when the user asks for it.
