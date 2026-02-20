# Agent

Containerized Raspberry Pi edge print agent service boundary.

## Local commands

- `make install`
- `make lint`
- `make test`
- `make build`
- `make container-build`
- `make validate-print-path`

## Environment setup

1. Copy `.env.example` to `.env`.
2. Fill in required values listed in `config/required-env.txt`.
3. Validate runtime readiness with `node --experimental-strip-types ../scripts/env/validate-env.ts config/required-env.txt .env`.

## Runtime configuration

- `CUPS_PRINTER_NAME` selects the CUPS destination passed to `lp -d`.
- `LP_COMMAND_PATH` controls which `lp` binary is validated and executed.
- `AGENT_VALIDATE_ONLY=true` runs startup validation then exits.

## Raspberry Pi host driver install (DYMO 450)

Install CUPS plus the DYMO driver package directly on the Raspberry Pi host:

```bash
sudo ./scripts/agent/install-dymo-450-driver.sh
```

Notes:

- This is a host-level setup step (not inside the agent container).
- The script configures a CUPS queue named `dymo` by default (override with `QUEUE_NAME=<name>`).
- If your distro does not provide `printer-driver-dymo`, the script falls back to `printer-driver-all`.

## Interface contracts

1. MQTT backend-agent contract: `../contracts/asyncapi.yaml`.
2. MQTT versioning policy: `../docs/asyncapi-versioning-policy.md`.
3. Topic ACL and broker security expectations: `../docs/security.md`.

## Container image

The image is built as a multi-stage Go build and supports architecture-targeted output via `TARGETARCH`.

Build locally for Raspberry Pi (`linux/arm64`):

```bash
make container-build
```

Equivalent explicit build command:

```bash
docker build \
  --platform linux/arm64 \
  --file Dockerfile \
  --tag leftover-label-printer/agent:local \
  .
```

## Raspberry Pi print path validation

On the Raspberry Pi host, validate CUPS print command wiring before enabling queue processing:

```bash
make validate-print-path LP_COMMAND_PATH=/usr/bin/lp CUPS_PRINTER_NAME=dymo
```

For a containerized check against host CUPS socket:

```bash
docker run --rm \
  --network host \
  -e AGENT_PRINTER_ID=printer-01 \
  -e AGENT_SPOOL_DIR=/var/lib/leftover-agent/spool \
  -e CUPS_PRINTER_NAME=dymo \
  -e LP_COMMAND_PATH=/usr/bin/lp \
  -e AGENT_VALIDATE_ONLY=true \
  -v /var/run/cups/cups.sock:/var/run/cups/cups.sock \
  leftover-label-printer/agent:local
```
