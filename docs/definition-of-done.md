# Definition Of Done

A task is done only when all applicable checks below pass.

## Delivery Checklist

1. Implementation matches scope in the Linear issue.
2. Acceptance criteria are fully satisfied.
3. Relevant docs are updated (architecture, state machine, security, ADR).
4. Contract files updated when interfaces changed:
   - `contracts/openapi.yaml` for HTTP
   - `contracts/asyncapi.yaml` for MQTT

## Quality Checklist

1. Unit tests added or updated.
2. Contract tests added or updated.
3. No failing CI checks.
4. Logs and error handling added for new failure paths.

## Security Checklist

1. Auth and RBAC behavior validated for new endpoints/actions.
2. No secrets in code, tests, or docs.
3. Least-privilege access preserved for broker and storage.

## Operability Checklist

1. Trace IDs preserved end-to-end for new flows.
2. Failure scenarios have clear recoverability behavior.
3. Rollback implications are documented in issue or PR notes.

## Review and Handoff Checklist

1. PR description includes changed behavior summary.
2. PR links to Linear issue and relevant contract diff.
3. Linear issue comment includes what was delivered and what remains.
