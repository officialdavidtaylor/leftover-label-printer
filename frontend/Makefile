SHELL := /bin/sh
SERVICE := frontend

.PHONY: install lint test build ensure-deps

install:
	@cd .. && npm ci

ensure-deps:
	@if [ ! -d ../node_modules ]; then \
		printf "[%s] dependencies missing; running npm ci at repository root.\n" "$(SERVICE)"; \
		cd .. && npm ci; \
	fi

lint: ensure-deps
	@cd .. && npm run --silent frontend:lint

test: ensure-deps
	@cd .. && npm run --silent frontend:test

build: ensure-deps
	@cd .. && npm run --silent frontend:build
