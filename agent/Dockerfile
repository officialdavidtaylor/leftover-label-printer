# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.23.5
ARG ALPINE_VERSION=3.21

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine${ALPINE_VERSION} AS build

ARG TARGETOS=linux
ARG TARGETARCH=arm64

WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY README.md ./README.md

RUN --mount=type=cache,target=/root/.cache/go-build \
  CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
  go build \
    -trimpath \
    -buildvcs=false \
    -ldflags="-s -w -buildid=" \
    -o /out/leftover-agent \
    ./cmd/agent

FROM alpine:${ALPINE_VERSION}

RUN apk add --no-cache ca-certificates cups-client

WORKDIR /app

COPY README.md /app/README.md
COPY --from=build /out/leftover-agent /usr/local/bin/leftover-agent

ENV LP_COMMAND_PATH=/usr/bin/lp
ENV AGENT_SPOOL_DIR=/var/lib/leftover-agent/spool

ENTRYPOINT ["/usr/local/bin/leftover-agent"]
