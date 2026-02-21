SHELL := /bin/sh
SERVICE := agent
GO ?= go
GO_CACHE_DIR := $(CURDIR)/.cache/go-build
GO_MOD_CACHE_DIR := $(CURDIR)/.cache/go-mod
GO_ENV := GOTOOLCHAIN=local GOCACHE=$(GO_CACHE_DIR) GOMODCACHE=$(GO_MOD_CACHE_DIR)
PKG := ./...
BIN_DIR := bin
BINARY := leftover-agent
DOCKER_IMAGE ?= leftover-label-printer/agent
DOCKER_PLATFORM ?= linux/arm64
DOCKERFILE := Dockerfile

AGENT_PRINTER_ID ?= printer-01
AGENT_SPOOL_DIR ?= /var/lib/leftover-agent/spool
CUPS_PRINTER_NAME ?= dymo
LP_COMMAND_PATH ?= /usr/bin/lp

.PHONY: install lint test build container-build validate-print-path clean

install:
	@if command -v $(GO) >/dev/null 2>&1; then \
		set -e; \
		mkdir -p $(GO_CACHE_DIR) $(GO_MOD_CACHE_DIR); \
		$(GO_ENV) $(GO) mod download; \
		printf "[%s] install: Go modules downloaded.\n" "$(SERVICE)"; \
	else \
		printf "[%s] install: go not installed; skipped module download.\n" "$(SERVICE)"; \
	fi

lint:
	@if command -v $(GO) >/dev/null 2>&1; then \
		set -e; \
		mkdir -p $(GO_CACHE_DIR) $(GO_MOD_CACHE_DIR); \
		unformatted="$$(gofmt -l $$(find . -type f -name '*.go'))"; \
		if [ -n "$$unformatted" ]; then \
			printf "[%s] lint: gofmt required for:\n%s\n" "$(SERVICE)" "$$unformatted"; \
			exit 1; \
		fi; \
		$(GO_ENV) $(GO) vet $(PKG); \
		printf "[%s] lint: gofmt and go vet passed.\n" "$(SERVICE)"; \
	else \
		printf "[%s] lint: go not installed; skipped checks.\n" "$(SERVICE)"; \
	fi

test:
	@if command -v $(GO) >/dev/null 2>&1; then \
		set -e; \
		mkdir -p $(GO_CACHE_DIR) $(GO_MOD_CACHE_DIR); \
		$(GO_ENV) $(GO) test $(PKG); \
	else \
		printf "[%s] test: go not installed; skipped tests.\n" "$(SERVICE)"; \
	fi

build:
	@if command -v $(GO) >/dev/null 2>&1; then \
		set -e; \
		mkdir -p $(GO_CACHE_DIR) $(GO_MOD_CACHE_DIR); \
		mkdir -p $(BIN_DIR); \
		CGO_ENABLED=0 $(GO_ENV) $(GO) build \
			-trimpath \
			-buildvcs=false \
			-ldflags "-s -w -buildid=" \
			-o $(BIN_DIR)/$(BINARY) \
			./cmd/agent; \
		printf "[%s] build: created %s/%s.\n" "$(SERVICE)" "$(BIN_DIR)" "$(BINARY)"; \
	else \
		printf "[%s] build: go not installed; skipped binary build.\n" "$(SERVICE)"; \
	fi

container-build:
	@if command -v docker >/dev/null 2>&1; then \
		set -e; \
		docker build \
			--platform $(DOCKER_PLATFORM) \
			--file $(DOCKERFILE) \
			--tag $(DOCKER_IMAGE):local \
			.; \
		printf "[%s] container-build: built %s:local for %s.\n" "$(SERVICE)" "$(DOCKER_IMAGE)" "$(DOCKER_PLATFORM)"; \
	else \
		printf "[%s] container-build: docker not installed; skipped image build.\n" "$(SERVICE)"; \
	fi

validate-print-path: build
	@if [ ! -x $(BIN_DIR)/$(BINARY) ]; then \
		printf "[%s] validate-print-path: binary not available (build skipped).\n" "$(SERVICE)"; \
		exit 0; \
	fi
	@AGENT_PRINTER_ID=$(AGENT_PRINTER_ID) \
	AGENT_SPOOL_DIR=$(AGENT_SPOOL_DIR) \
	CUPS_PRINTER_NAME=$(CUPS_PRINTER_NAME) \
	LP_COMMAND_PATH=$(LP_COMMAND_PATH) \
	AGENT_VALIDATE_ONLY=true \
	$(BIN_DIR)/$(BINARY)

clean:
	@rm -rf $(BIN_DIR)
