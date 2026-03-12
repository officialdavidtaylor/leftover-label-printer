SHELL := /bin/sh
SERVICE := backend

.PHONY: install lint test build

install:
	@npm ci

lint:
	@npm run typecheck:backend

test:
	@npm run backend:test
	@npm run provider-contract:test

build:
	@if command -v docker >/dev/null 2>&1; then \
		docker build --file Dockerfile --tag leftover-label-printer/backend:local ..; \
	else \
		printf "[%s] build: docker not installed; skipped image build.\n" "$(SERVICE)"; \
	fi
