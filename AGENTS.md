# AGENTS.md

Scope: repo-wide. Deeper `AGENTS.md` overrides.

Sub-app overrides:
- `frontend/AGENTS.md`
- `backend/AGENTS.md`
- `agent/AGENTS.md`
- `infra/AGENTS.md`
- `contracts/AGENTS.md`

Defaults:
- Use Linear MCP for issue lifecycle updates (`In Progress` at start; `Done` + summary comment after merge)
- Use `gh` CLI for PR creation/updates
- Use conventional commits, keep history clean/linear for review and rollback
- Use Zod for JS/TS runtime schemas/validation
- Keep interface changes contract-first with contract tests in same change:
  - `contracts/openapi.yaml`
  - `contracts/asyncapi.yaml`
