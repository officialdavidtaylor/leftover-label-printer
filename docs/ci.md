# CI Pipeline Baseline

This repository uses GitHub Actions for pull-request guardrails.

## Workflow

- File: `.github/workflows/ci.yml`
- Triggers: `pull_request`, `push` to `main`, and manual `workflow_dispatch`

## Jobs

1. `lint-test (frontend|backend|agent)`
   - Runs service lint and test commands via root make targets.
2. `image-build (backend|agent)`
   - Validates backend and agent container image build readiness.

## Required checks configuration

GitHub branch protection settings must require the following checks on `main`:

1. `lint-test (frontend)`
2. `lint-test (backend)`
3. `lint-test (agent)`
4. `image-build (backend)`
5. `image-build (agent)`

Use the helper command below to apply required checks via GitHub API:

```bash
action='{"required_status_checks":{"strict":true,"contexts":["lint-test (frontend)","lint-test (backend)","lint-test (agent)","image-build (backend)","image-build (agent)"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,"allow_force_pushes":false,"allow_deletions":false,"block_creations":false,"required_conversation_resolution":true,"lock_branch":false,"allow_fork_syncing":true}'
gh api \
  --method PUT \
  repos/officialdavidtaylor/leftover-label-printer/branches/main/protection \
  --input - <<<"$action"
```

## Local parity commands

These commands mirror what CI executes:

1. `make lint-frontend && make test-frontend`
2. `make lint-backend && make test-backend`
3. `make lint-agent && make test-agent`
4. `docker build -f backend/Dockerfile backend`
5. `docker build -f agent/Dockerfile agent`
