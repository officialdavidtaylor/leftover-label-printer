# Agent

Raspberry Pi edge print agent service boundary.

Use local commands:

- `make install`
- `make lint`
- `make test`
- `make build`

Environment setup:

1. Copy `.env.example` to `.env`.
2. Fill in required values listed in `config/required-env.txt`.
3. Validate runtime readiness with `node --experimental-strip-types ../scripts/env/validate-env.ts config/required-env.txt .env`.

Interface contracts:

1. MQTT backend-agent contract: `../contracts/asyncapi.yaml`.
2. MQTT versioning policy: `../docs/asyncapi-versioning-policy.md`.
3. Topic ACL and broker security expectations: `../docs/security.md`.
