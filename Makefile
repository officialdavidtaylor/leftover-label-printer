SHELL := /bin/sh

SERVICES := frontend backend agent infra

.PHONY: help install lint test build smoke env-test \
	install-frontend install-backend install-agent install-infra \
	lint-frontend lint-backend lint-agent lint-infra \
	test-frontend test-backend test-agent test-infra \
	build-frontend build-backend build-agent build-infra

help:
	@printf "Workspace targets:\n"
	@printf "  make install        Run install/setup entrypoint for all services\n"
	@printf "  make lint           Run lint entrypoint for all services\n"
	@printf "  make test           Run test entrypoint for all services\n"
	@printf "  make build          Run build entrypoint for all services\n"
	@printf "  make <target>-<service> (example: make test-backend)\n"

install:
	@for service in $(SERVICES); do \
		$(MAKE) -C $$service install || exit $$?; \
	done

lint:
	@for service in $(SERVICES); do \
		$(MAKE) -C $$service lint || exit $$?; \
	done

test:
	@for service in $(SERVICES); do \
		$(MAKE) -C $$service test || exit $$?; \
	done
	@$(MAKE) env-test

build:
	@for service in $(SERVICES); do \
		$(MAKE) -C $$service build || exit $$?; \
	done

smoke:
	@$(MAKE) install
	@$(MAKE) lint
	@$(MAKE) test
	@$(MAKE) build

env-test:
	@node --test ./tests/env/validate-env.test.mjs

install-frontend:
	@$(MAKE) -C frontend install

install-backend:
	@$(MAKE) -C backend install

install-agent:
	@$(MAKE) -C agent install

install-infra:
	@$(MAKE) -C infra install

lint-frontend:
	@$(MAKE) -C frontend lint

lint-backend:
	@$(MAKE) -C backend lint

lint-agent:
	@$(MAKE) -C agent lint

lint-infra:
	@$(MAKE) -C infra lint

test-frontend:
	@$(MAKE) -C frontend test

test-backend:
	@$(MAKE) -C backend test

test-agent:
	@$(MAKE) -C agent test

test-infra:
	@$(MAKE) -C infra test

build-frontend:
	@$(MAKE) -C frontend build

build-backend:
	@$(MAKE) -C backend build

build-agent:
	@$(MAKE) -C agent build

build-infra:
	@$(MAKE) -C infra build
