#!/bin/sh
set -eu

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  printf "infra security: env file not found: %s\n" "$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

deployment_env="${EMQX_DEPLOYMENT_ENV:-local}"
require_tls="${EMQX_REQUIRE_TLS:-false}"
enable_plain_mqtt="${EMQX_ENABLE_PLAIN_MQTT:-true}"

if [ "$deployment_env" != "local" ]; then
  if [ "$require_tls" != "true" ]; then
    printf "infra security: EMQX_REQUIRE_TLS must be true when EMQX_DEPLOYMENT_ENV is %s.\n" "$deployment_env" >&2
    exit 1
  fi

  if [ "$enable_plain_mqtt" != "false" ]; then
    printf "infra security: EMQX_ENABLE_PLAIN_MQTT must be false when EMQX_DEPLOYMENT_ENV is %s.\n" "$deployment_env" >&2
    exit 1
  fi
fi

if [ "$require_tls" = "true" ]; then
  cert_dir="${EMQX_TLS_CERT_DIR:-./emqx/certs}"
  ca_file="${EMQX_TLS_CA_CERT_FILE:-ca.crt}"
  cert_file="${EMQX_TLS_CERT_FILE:-server.crt}"
  key_file="${EMQX_TLS_KEY_FILE:-server.key}"

  for file in "$ca_file" "$cert_file" "$key_file"; do
    if [ ! -f "${cert_dir}/${file}" ]; then
      printf "infra security: missing TLS file: %s/%s\n" "$cert_dir" "$file" >&2
      exit 1
    fi
  done
fi

printf "infra security: EMQX TLS/auth guardrails passed for %s.\n" "$deployment_env"
