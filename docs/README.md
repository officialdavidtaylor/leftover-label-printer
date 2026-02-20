# Project Context Pack

This folder is the single source of truth for migration context and delivery rules.

Read these files before starting any implementation task:

1. `docs/mission.md`
2. `docs/architecture.md`
3. `docs/state-machine.md`
4. `contracts/openapi.yaml`
5. `contracts/asyncapi.yaml`
6. `docs/security.md`
7. `docs/definition-of-done.md`
8. `docs/environment-and-secrets.md`
9. `docs/local-dependency-stack.md`
10. `docs/ci.md`
11. `docs/rbac-authorization-matrix.md`
12. `docs/authentik-oidc-setup.md`
13. `docs/jwt-verification.md`
14. `docs/openapi-versioning-policy.md`
15. `docs/asyncapi-versioning-policy.md`

Repository implementation conventions:

1. Use Node/TypeScript for repo-wide developer and CI scripts.
2. Implement runtime config validation in each service's native language.

Use this template when creating or refining Linear work items:

- `docs/templates/linear-agent-issue-template.md`

Architecture decision records (ADRs) belong in:

- `docs/adr/`
