# OpenAPI Versioning Policy

This document defines how HTTP contract changes are managed for `contracts/openapi.yaml`.

## Source Of Truth

1. `contracts/openapi.yaml` is the canonical HTTP contract for MVP endpoints:
   - `POST /v1/print-jobs`
   - `GET /v1/print-jobs/{jobId}`
2. Backend and frontend integration changes must be contract-first.
3. Published operation IDs and schema names are treated as stable API identifiers.

## Versioning Rules

1. Contract versions follow semantic versioning (`MAJOR.MINOR.PATCH`).
2. Non-breaking additive changes use `MINOR` or `PATCH`.
3. Breaking changes require a `MAJOR` version bump.

## Breaking Change Process

1. Every breaking change must include a deprecation window of at least 90 days.
2. The PR introducing a breaking change must include migration guidance for integrators.
3. Deprecation timelines and migration notes must be captured in PR/release notes.

## Coordination Expectations

1. API providers and consumers must validate against the same `contracts/openapi.yaml` revision in CI.
2. Contract-test failures are release blockers for affected services.
