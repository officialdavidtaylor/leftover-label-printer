# Agent AGENTS

Scope: `agent/` (Go edge runtime).

- Runtime implementation is Go.
- Keep broker/printer behavior env-driven; avoid hard-coded environment-specific names.
- MQTT topic/payload changes must update `contracts/asyncapi.yaml` and tests.
