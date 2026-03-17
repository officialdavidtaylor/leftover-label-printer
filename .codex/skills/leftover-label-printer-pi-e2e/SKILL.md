---
name: leftover-label-printer-pi-e2e
description: Run the leftover-label-printer Raspberry Pi hardware end-to-end print loop using the local Docker stack on this machine and the real agent on the SSH-reachable Pi host `label-printer-01`. Use when Codex needs to validate a real Dymo/CUPS print, rerun the Pi hardware smoke test, troubleshoot LAN reachability between the repo host and the Pi, or gather happy-path evidence from a live job without adding repo runtime code.
---

# Leftover Label Printer Pi E2E

## Overview

Run the backend and infra locally, run the agent on the Raspberry Pi over SSH, submit a live print job, and verify that the backend reaches `printed` with matching Pi-side log evidence. Keep operational automation inside this skill instead of adding new repo runtime scripts.

Read [references/pi-hardware-loop.md](references/pi-hardware-loop.md) before the first execution in a turn. Use [scripts/submit_and_wait.ts](scripts/submit_and_wait.ts) for the job submission and terminal-state polling step instead of rewriting that logic inline.

## Workflow

1. Work from repo root and keep product code unchanged unless the user explicitly asks for repo edits.
2. Detect or confirm the LAN IPv4 address this machine should advertise to the Pi. Prefer the same subnet as the `ssh -G label-printer-01` hostname.
3. Create a temporary compose override that sets backend `S3_ENDPOINT` to `http://<lan-ip>:9002` so MinIO signed URLs are reachable from the Pi.
4. Start local Docker services without `mock-agent`, then run the existing repo bootstrap scripts for EMQX auth and local Keycloak/MinIO state.
5. Build `agent/bin/leftover-agent-linux-arm64`.
6. SSH and SCP with `-o IdentitiesOnly=no`. Validate backend, MinIO, MQTT, and the remote CUPS queue before submitting a job.
7. Copy the binary to `~/leftover-agent-e2e/leftover-agent`, run a validate-only startup, then start the real agent in the background with logs in `~/leftover-agent-e2e/agent.log`.
8. Use `scripts/submit_and_wait.ts` against `http://localhost:8080` to submit the live print job and wait for a terminal state.
9. Treat success as both backend state `printed` and Pi log evidence that includes `mqtt_consumer_subscribed` plus an `lp` request id.
10. Clean up by default: stop the remote agent, bring the local stack down, and remove temporary override files unless the user asked to keep them.

## Guardrails

1. Do not use the Pi service port `4000`.
2. Do not start `mock-agent` for the hardware loop.
3. Force `IdentitiesOnly=no` for SSH and SCP because the host config uses a 1Password-backed agent.
4. Request escalation when Docker, SSH, SCP, or LAN network access is blocked by the sandbox.
5. Keep Keycloak bootstrap steps sequential with other `infra` helper commands that reuse `kcadm.sh`.
6. In user-facing output, prefer `~` for home-directory paths.
7. If preflight fails, stop and report the specific failing dependency: backend, MinIO, MQTT, SSH auth, or CUPS queue.

## Expected Evidence

1. Backend health check returns `{"status":"ok",...}`.
2. Remote preflight proves the Pi can reach `http://<lan-ip>:8080`, `http://<lan-ip>:9002`, and `mqtt://<lan-ip>:1883`.
3. Remote agent log shows a successful subscription to `printers/printer-01/jobs`.
4. Final output includes `jobId=...`, `terminalState=printed`, and a Pi log line containing `lpOutput:request id is ...`.

## Resources

1. [references/pi-hardware-loop.md](references/pi-hardware-loop.md) contains the exact command sequence, remote env values, and cleanup flow.
2. [scripts/submit_and_wait.ts](scripts/submit_and_wait.ts) submits the print job and polls until `printed` or `failed`.
