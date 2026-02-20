# Backend JWT Verification Contract (MVP)

This document defines backend JWT authentication behavior for protected API routes.

## Verification Requirements

For each bearer token, backend must verify:

1. Signature validity against issuer JWKS keys.
2. `iss` equals configured `OIDC_ISSUER_URL`.
3. `aud` includes configured `OIDC_AUDIENCE`.
4. `exp` is present and not expired.
5. Required claims include `sub` and canonical `roles` (array of non-empty strings).

Invalid or missing requirements return deterministic `401` responses using `ErrorResponse`.

## OIDC Discovery and JWKS Handling

1. Fetch discovery document from `/.well-known/openid-configuration` (or configured discovery URL).
2. Cache discovery document with bounded TTL.
3. Fetch and cache JWKS keys with bounded TTL.
4. On unknown `kid`, force-refresh JWKS once to support signing key rotation.
5. Fail closed on discovery/JWKS fetch errors.

## Error and Logging Expectations

1. Return `401` body: `{ code: \"unauthorized\", message: \"Unauthorized\", traceId? }`.
2. Keep logs token-safe: never log raw bearer tokens.
3. Log reason codes only (for example: `invalid_signature`, `invalid_issuer`) with `traceId`.
