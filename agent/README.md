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
3. Validate runtime readiness with `../scripts/env/validate_env.sh config/required-env.txt .env`.
