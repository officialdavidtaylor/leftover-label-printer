---
name: leftover-label-printer-pi-e2e-playwright
description: Run the leftover-label-printer Raspberry Pi hardware end-to-end print loop using the local Docker stack on this machine and the real agent on the SSH-reachable Pi host `label-printer-01`, but trigger the live print through the frontend UI with the Playwright MCP instead of posting directly to the backend. Use when Codex needs UI-driven print evidence, wants to exercise the creator/status routes against real hardware, or wants a Pi smoke test that covers the PWA plus backend/infra stack together.
---

# Leftover Label Printer Pi E2E (Playwright)

## Overview

Run the backend and infra locally, run the agent on the Raspberry Pi over SSH, start the frontend locally, trigger a live print through the creator UI with the Playwright MCP, and verify that the backend reaches `printed` with matching Pi-side log evidence.

Read [references/pi-hardware-loop-playwright.md](references/pi-hardware-loop-playwright.md) before the first execution in a turn. Use [scripts/wait_for_terminal.ts](scripts/wait_for_terminal.ts) for the post-submit terminal-state polling step instead of rewriting that logic inline.

## Workflow

1. Work from repo root and keep product code unchanged unless the user explicitly asks for repo edits.
2. Follow the same LAN host resolution, compose override, backend/infra startup, Pi preflight, and remote agent startup flow as the direct Pi E2E skill.
3. Start the frontend locally on `http://127.0.0.1:4173`.
4. Mint a dev bearer token from `make -C infra dev-token`.
5. Use the Playwright MCP to seed `leftover-label-printer.auth-session` into browser local storage, open `/app/print/new`, fill the creator form, and click the print button.
6. Capture the accepted `jobId` from the toast link or resulting status page URL.
7. Use `scripts/wait_for_terminal.ts` against `http://localhost:8080` to wait for the captured job to reach a terminal state.
8. Treat success as all of: creator submission accepted, backend state `printed`, and Pi log evidence that includes `mqtt_consumer_subscribed` plus an `lp` request id.
9. Clean up by default: stop the remote agent, stop the frontend dev server, bring the local stack down, and remove temporary files unless the user asked to keep them.

## Guardrails

1. Do not use the Pi service port `4000`.
2. Do not start `mock-agent` for the hardware loop.
3. Do not fall back to a direct backend `POST /v1/print-jobs` submission when the goal is the Playwright-triggered flow.
4. Request escalation when Docker, SSH, SCP, LAN network access, or the local frontend dev server is blocked by the sandbox.
5. Keep Keycloak bootstrap steps sequential with other `infra` helper commands that reuse `kcadm.sh`.
6. Use Playwright MCP for the UI interaction itself; use shell scripts only for stack orchestration and deterministic backend polling.
7. If frontend auth/session or test-id contracts drift, stop and report the specific mismatch instead of guessing.
8. In user-facing output, prefer `~` for home-directory paths.

## Expected Evidence

1. Backend health check returns `{"status":"ok",...}`.
2. Frontend responds on `http://127.0.0.1:4173`.
3. The creator route accepts a submission and exposes a status link containing `jobId`.
4. Backend polling prints `jobId=...`, `terminalState=printed`, and `jobStatusJson=...`.
5. Pi log evidence includes `mqtt_consumer_subscribed` and an `lpOutput:request id is ...` line.

## Resources

1. [references/pi-hardware-loop-playwright.md](references/pi-hardware-loop-playwright.md) contains the exact command sequence, frontend bootstrap, Playwright MCP interaction steps, and cleanup flow.
2. [scripts/wait_for_terminal.ts](scripts/wait_for_terminal.ts) polls an existing `jobId` until it reaches `printed` or `failed`.
