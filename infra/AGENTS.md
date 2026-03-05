# Infra AGENTS

Scope: `infra/` (dev infra/bootstrap/security).

- Prefer TypeScript scripts over shell when equivalent.
- Use Zod for TS env/config validation.
- Preserve EMQX bootstrap/security behavior (`scripts/bootstrap-emqx-auth.ts`, `scripts/validate-emqx-security.ts`).
