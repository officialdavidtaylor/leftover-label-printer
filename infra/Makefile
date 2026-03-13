SHELL := /bin/sh
SERVICE := infra

COMPOSE_FILE := docker-compose.yml
COMPOSE_DEV_FILE := docker-compose.dev.yml
ENV_FILE := .env
COMPOSE_CMD := docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE)
COMPOSE_DEV_CMD := docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) -f $(COMPOSE_DEV_FILE)
DEV_ARTIFACT_DIR := dev-artifacts

.PHONY: install lint test build up up-dev down down-dev reset reset-dev logs logs-dev ps ps-dev validate-security bootstrap-auth bootstrap-dev dev-token smoke-dev smoke-dev-failed

install:
	@if [ ! -f "$(ENV_FILE)" ]; then \
		cp .env.example "$(ENV_FILE)"; \
		printf "[%s] install: created %s from .env.example.\n" "$(SERVICE)" "$(ENV_FILE)"; \
	else \
		printf "[%s] install: using existing %s.\n" "$(SERVICE)" "$(ENV_FILE)"; \
	fi

validate-security: install
	@node --experimental-strip-types ./scripts/validate-emqx-security.ts "$(ENV_FILE)"

bootstrap-auth: install
	@node --experimental-strip-types ./scripts/bootstrap-emqx-auth.ts "$(ENV_FILE)"

lint: validate-security
	@if command -v docker >/dev/null 2>&1; then \
		$(COMPOSE_CMD) config -q; \
		printf "[%s] lint: docker compose config is valid.\n" "$(SERVICE)"; \
	else \
		printf "[%s] lint: docker not installed; skipped compose config validation.\n" "$(SERVICE)"; \
	fi

test: validate-security
	@if command -v docker >/dev/null 2>&1; then \
		$(COMPOSE_CMD) config -q; \
		$(COMPOSE_DEV_CMD) config -q; \
		printf "[%s] test: base and dev compose syntax validation passed.\n" "$(SERVICE)"; \
	else \
		printf "[%s] test: docker not installed; skipped runtime compose checks.\n" "$(SERVICE)"; \
	fi

build:
	@printf "[%s] build: no build artifact for local dependency stack.\n" "$(SERVICE)"

up: validate-security
	@$(COMPOSE_CMD) up -d --wait
	@node --experimental-strip-types ./scripts/bootstrap-emqx-auth.ts "$(ENV_FILE)"

bootstrap-dev: install
	@node --experimental-strip-types ./scripts/bootstrap-local-dev.ts "$(ENV_FILE)"

up-dev: validate-security
	@$(COMPOSE_DEV_CMD) up -d --wait mongodb emqx minio keycloak
	@node --experimental-strip-types ./scripts/bootstrap-emqx-auth.ts "$(ENV_FILE)"
	@node --experimental-strip-types ./scripts/bootstrap-local-dev.ts "$(ENV_FILE)"
	@$(COMPOSE_DEV_CMD) up -d --build --wait backend mock-agent

down: install
	@$(COMPOSE_CMD) down --remove-orphans

down-dev: install
	@$(COMPOSE_DEV_CMD) down --remove-orphans

reset: install
	@$(COMPOSE_CMD) down -v --remove-orphans

reset-dev: install
	@$(COMPOSE_DEV_CMD) down -v --remove-orphans
	@rm -rf "$(DEV_ARTIFACT_DIR)"

logs: install
	@$(COMPOSE_CMD) logs -f --tail=200

logs-dev: install
	@$(COMPOSE_DEV_CMD) logs -f --tail=200

ps: install
	@$(COMPOSE_CMD) ps

ps-dev: install
	@$(COMPOSE_DEV_CMD) ps

dev-token: install
	@node --experimental-strip-types ./scripts/dev-token.ts "$(ENV_FILE)"

smoke-dev: install
	@node --experimental-strip-types ./scripts/smoke-dev.ts "$(ENV_FILE)"

smoke-dev-failed: install
	@node --experimental-strip-types ./scripts/smoke-dev.ts "$(ENV_FILE)" --expected-state=failed
