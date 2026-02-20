SHELL := /bin/sh
SERVICE := infra

COMPOSE_FILE := docker-compose.yml
ENV_FILE := .env
COMPOSE_CMD := docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE)

.PHONY: install lint test build up down reset logs ps validate-security bootstrap-auth

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
		printf "[%s] test: compose syntax validation passed.\n" "$(SERVICE)"; \
	else \
		printf "[%s] test: docker not installed; skipped runtime compose checks.\n" "$(SERVICE)"; \
	fi

build:
	@printf "[%s] build: no build artifact for local dependency stack.\n" "$(SERVICE)"

up: validate-security
	@$(COMPOSE_CMD) up -d --wait
	@node --experimental-strip-types ./scripts/bootstrap-emqx-auth.ts "$(ENV_FILE)"

down: install
	@$(COMPOSE_CMD) down --remove-orphans

reset: install
	@$(COMPOSE_CMD) down -v --remove-orphans

logs: install
	@$(COMPOSE_CMD) logs -f --tail=200

ps: install
	@$(COMPOSE_CMD) ps
