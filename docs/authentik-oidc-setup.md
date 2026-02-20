# Authentik OIDC Setup (MVP)

This document defines the canonical OIDC contract between authentik, frontend, and backend.

## Canonical Contract

1. Issuer URL: `OIDC_ISSUER_URL` / `VITE_OIDC_ISSUER_URL`
2. API audience: `OIDC_AUDIENCE` / `VITE_OIDC_AUDIENCE`
3. Canonical role claim: `roles` (array of strings)
4. MVP role values: `user`, `sysadmin`

## Frontend OIDC App (Authorization Code + PKCE)

Configure an authentik OAuth2/OpenID Provider application for the PWA client:

1. Client type: Public client
2. Grant type: Authorization Code
3. Response type: `code`
4. PKCE: Required (`S256`)
5. Redirect URI(s): frontend callback URL(s) for each environment
6. Post logout redirect URI(s): frontend sign-out return URL(s)
7. Allowed scopes: `openid profile email`
8. Optional audience parameter: `leftover-label-printer-api`

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

Backend consumes only canonical `roles`; it must not couple to provider-specific raw group fields.

## Claim Mapping Rules

Map authentik role/group data to canonical `roles` claim in the access token.

1. Include `roles` in access tokens as an array of lowercase strings.
2. Map authentik user/group membership to:
   - `user` for all authenticated app users
   - `sysadmin` only for platform operators
3. Do not emit unknown role values unless backend RBAC matrix is updated first.

Example payload excerpt:

```json
{
  "iss": "https://auth.example.com/application/o/leftover-label-printer/",
  "aud": "leftover-label-printer-api",
  "roles": ["user"]
}
```

## Environment and Secret Handling

1. Client secrets (if confidential clients are added later) must be environment-scoped and never committed.
2. Keep `.env.example` files non-secret.
3. Store production secrets only in deployment secret stores.

## Verification Checklist

1. Frontend receives authorization code via PKCE flow.
2. Backend can fetch signing keys from `OIDC_JWKS_URL`.
3. Access token `iss` and `aud` values match backend config.
4. Access token contains `roles` with at least one of `user` or `sysadmin`.
