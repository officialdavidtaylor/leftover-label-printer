# AsyncAPI Versioning Policy

This document defines how MQTT contract changes are managed for `contracts/asyncapi.yaml`.

## Source Of Truth

1. `contracts/asyncapi.yaml` is the canonical MQTT contract for backend-agent interactions.
2. Published channels and message schema names are treated as stable identifiers:
   - `printers/{id}/jobs`
   - `printers/{id}/status`
3. The `schemaVersion` payload field is mandatory in command and status messages.

## Versioning Rules

1. Contract and payload schema versions follow semantic versioning (`MAJOR.MINOR.PATCH`).
2. Major version `1` is the current compatibility line for payload schemas.
3. Non-breaking additive changes use `MINOR` or `PATCH`.
4. Breaking changes require a `MAJOR` version bump.

## Breaking Change Process

1. Every breaking change must include a deprecation window of at least 90 days.
2. The PR introducing a breaking change must include migration guidance for backend and agent implementers.
3. Deprecation timelines and migration notes must be captured in PR/release notes.

## Coordination Expectations

1. Backend and agent implementations must validate against the same `contracts/asyncapi.yaml` revision in CI.
2. Contract-test failures are release blockers for affected services.
