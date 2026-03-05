# Backend AGENTS

Scope: `backend/` (Node API/orchestration).

- Use Zod-first validation for request/config/internal boundaries.
- Keep shared auth/role definitions DRY.
- HTTP/MQTT schema changes must update contracts:
  - `contracts/openapi.yaml`
  - `contracts/asyncapi.yaml`
- Keep contract tests updated in same change (`npm run contracts:test`, `npm run provider-contract:test`).
