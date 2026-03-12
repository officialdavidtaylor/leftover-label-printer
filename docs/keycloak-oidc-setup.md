# Keycloak OIDC Setup (MVP)

This document defines the canonical OIDC contract between Keycloak, frontend, and backend.

## Canonical Contract

1. Issuer URL: `OIDC_ISSUER_URL` / `VITE_OIDC_ISSUER_URL`
2. API audience: `OIDC_AUDIENCE` / `VITE_OIDC_AUDIENCE`
3. Canonical role claim: `roles` (array of strings)
4. MVP role values: `user`, `sysadmin`

Local-development defaults:

1. Realm: `leftover-label-printer`
2. Issuer URL: `http://localhost:9000/realms/leftover-label-printer`
3. JWKS URL: `http://localhost:9000/realms/leftover-label-printer/protocol/openid-connect/certs`
4. PWA client ID: `leftover-label-printer-pwa`
5. API audience: `leftover-label-printer-api`

## Frontend OIDC Client (Authorization Code + PKCE)

Configure a Keycloak public client for the PWA:

1. Client ID: `leftover-label-printer-pwa`
2. Client authentication: Off
3. Standard flow: Enabled
4. Direct access grants: Disabled
5. PKCE code challenge method: `S256`
6. Valid redirect URI(s): frontend callback URL(s) for each environment
7. Valid post logout redirect URI(s): frontend sign-out return URL(s)
8. Web origins: frontend origin(s) for each environment
9. Default scopes must include `openid`

Frontend env contract:

1. `VITE_OIDC_ISSUER_URL`
2. `VITE_OIDC_CLIENT_ID`
3. `VITE_OIDC_AUDIENCE`
4. `VITE_OIDC_RESPONSE_TYPE=code`
5. `VITE_OIDC_USE_PKCE=true`

## Backend API Validation Contract

Backend must verify access tokens against:

1. Issuer: `OIDC_ISSUER_URL`
2. Audience: `OIDC_AUDIENCE`
3. JWKS endpoint: `OIDC_JWKS_URL`
4. Canonical role claim name: `OIDC_ROLES_CLAIM=roles`

Backend consumes only canonical `roles`; it must not couple to Keycloak-specific raw role fields.

## Claim Mapping Rules

Create Keycloak roles and mappers so access tokens expose the repo's canonical contract:

1. Create realm roles `user` and `sysadmin`.
2. Assign `user` to all application users and `sysadmin` only to platform operators.
3. Add an audience mapper so access tokens presented to the backend include `leftover-label-printer-api` in `aud`.
4. Add a token mapper that writes the effective role list to a top-level `roles` claim as an array of lowercase strings.
5. Do not emit unknown role values unless backend RBAC and docs are updated first.

Example payload excerpt:

```json
{
  "iss": "http://localhost:9000/realms/leftover-label-printer",
  "aud": ["account", "leftover-label-printer-api"],
  "roles": ["user"]
}
```

## Environment and Secret Handling

1. Public frontend client should not use a client secret.
2. Keep `.env.example` files non-secret.
3. Store any confidential-client secrets only in environment-scoped secret stores.

## Verification Checklist

1. Keycloak realm `leftover-label-printer` exists and is reachable from the frontend/backend network.
2. Frontend receives an authorization code via PKCE flow.
3. Backend can fetch signing keys from `OIDC_JWKS_URL`.
4. Access token `iss` and `aud` values match backend config.
5. Access token contains `roles` with at least one of `user` or `sysadmin`.
