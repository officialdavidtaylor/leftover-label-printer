# Frontend

React PWA service boundary.

Use local commands:

- `make install`
- `make lint`
- `make test`
- `make build`
- `npm run test:e2e`

Environment setup:

1. Copy `.env.example` to `.env`.
2. Fill in required values listed in `config/required-env.txt`.
3. Validate runtime readiness with `node --experimental-strip-types ../scripts/env/validate-env.ts config/required-env.txt .env`.
4. For host-local development, `FRONTEND_API_PROXY_TARGET` defaults to `http://localhost:8080`.
5. In the Docker Compose dev overlay, the proxy target is injected as `http://backend:8080`.

App shape:

1. Public marketing page at `/`
2. Login page at `/login`
3. PWA launch route at `/app/print/new`
4. Print status route at `/app/jobs/:jobId`
