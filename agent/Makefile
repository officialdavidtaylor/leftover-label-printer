SHELL := /bin/sh
SERVICE := agent

.PHONY: install lint test build

install:
	@go mod tidy

lint:
	@go vet ./...

test:
	@go test ./...

build:
	@go build ./...
