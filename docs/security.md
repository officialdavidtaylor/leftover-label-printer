# Security Model

## User Authentication and Authorization

1. Identity provider: self-hosted authentik with OIDC.
2. Frontend auth flow: Authorization Code + PKCE.
3. Backend token validation: issuer, audience, signature, expiry, and required claims.
4. Canonical role claim: `roles` (array of strings) in JWT access tokens.
5. Role model: minimum `user` and `sysadmin`.
6. Authorization enforcement: route-level RBAC in backend with ownership checks:
   - `user`: limited to own jobs/resources.
   - `sysadmin`: cross-user visibility for platform management operations.

## MQTT and Device Security

1. Broker: self-hosted EMQX with TLS in non-local environments.
2. Device identity: unique credentials per edge node.
3. Topic ACL backend publish: `printers/{printerId}/jobs`.
4. Topic ACL backend subscribe: `printers/{printerId}/status`.
5. Topic ACL agent permissions are limited to its own `printerId`.
6. No wildcard publish rights for edge nodes.

## Object Storage Security

1. PDF objects are private by default.
2. Edge download uses short-lived presigned URLs.
3. URLs are read-only and object-scoped.
4. Storage credentials are not distributed to edge nodes.

## Edge Node Hardening

1. Outbound-only connectivity model.
2. Agent runs as non-root where possible.
3. Durable local spool encrypted at rest when feasible.
4. Container image pinned and rebuilt through CI.

## Audit and Observability

1. Append-only audit records for auth, job, and sysadmin actions.
2. Structured logs with `traceId` across API and MQTT boundaries.
3. Alerts for print failure spikes and offline nodes.

## Secret Management

1. Never commit secrets.
2. Keep `.env.example` only for variable names.
3. Production secrets managed in deployment environment secret stores.
