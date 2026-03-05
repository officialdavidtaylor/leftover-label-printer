# Frontend

React PWA service boundary.

Implemented in this phase:

- OIDC Authorization Code + PKCE session flow core (`frontend/src/auth`)
- Protected API client bearer token injection + unauthorized handling (`frontend/src/api`)
- Frontend auth/session tests (`tests/frontend`)

Use local commands:

- `make install`
- `make lint`
- `make test`
- `make build`

Environment setup:

1. Copy `.env.example` to `.env`.
2. Fill in required values listed in `config/required-env.txt`.
3. Validate runtime readiness with `node --experimental-strip-types ../scripts/env/validate-env.ts config/required-env.txt .env`.
