# Mission

## Problem

The current system is a single Raspberry Pi Go server reachable only on local LAN. It is fragile, hard to evolve, and limited to one printer.

## Product Goal

Build a secure, cloud-connected multi-printer label platform that:

1. Lets authenticated users submit print jobs from a phone-friendly PWA.
2. Routes jobs to specific edge printer nodes over MQTT.
3. Tracks job lifecycle end-to-end with auditable events.
4. Survives node and network instability without job loss.

## MVP Goals

1. One production template rendered in Node backend.
2. One print flow: submit -> render -> store -> dispatch -> print -> final status.
3. Auth via authentik OIDC and backend RBAC.
4. Secure broker and object access.
5. Deterministic state machine and contract tests for HTTP + MQTT.

## Non-Goals (Initial MVP)

1. Full template editor UI.
2. Rich analytics dashboard.
3. Advanced printer scheduling or load balancing.
4. Multi-tenant organization model.

## Success Criteria

1. No manual hard reboot required for normal transient failures.
2. Print jobs are not lost after edge restart or temporary disconnect.
3. `printed` status is only set from validated edge outcome events.
4. All interface changes are governed by OpenAPI and AsyncAPI contracts.

## Delivery Plan

1. Sprint 1 (Feb 23 - Mar 6, 2026): foundation, auth, core API/data, HTTP contracts.
2. Sprint 2 (Mar 9 - Mar 20, 2026): render/storage dispatch, edge print path, MQTT contracts.
3. Sprint 3 (Mar 23 - Apr 3, 2026): PWA flow, audit/observability core, integration contract coverage.
4. Sprint 4 (Apr 6 - Apr 17, 2026): pilot, cutover, hardening alerts, contract governance gate.

## Scope Authority

When in doubt, prioritize:

1. Reliability of printing.
2. Security and least privilege.
3. Contract compatibility.
4. Fast operator recovery.
