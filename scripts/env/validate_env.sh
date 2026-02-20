#!/bin/sh

set -eu

mode="require-values"

if [ "${1:-}" = "--keys-only" ]; then
  mode="keys-only"
  shift
fi

if [ "$#" -ne 2 ]; then
  echo "usage: $0 [--keys-only] <required-keys-file> <env-file>" >&2
  exit 2
fi

required_file="$1"
env_file="$2"

if [ ! -f "$required_file" ]; then
  echo "required keys file not found: $required_file" >&2
  exit 2
fi

if [ ! -f "$env_file" ]; then
  echo "env file not found: $env_file" >&2
  exit 2
fi

missing_keys=""

while IFS= read -r raw_key || [ -n "$raw_key" ]; do
  key="$(printf '%s' "$raw_key" | sed 's/[[:space:]]*$//')"

  case "$key" in
    ""|\#*)
      continue
      ;;
  esac

  line="$(grep -E "^[[:space:]]*${key}=" "$env_file" | tail -n 1 || true)"

  if [ -z "$line" ]; then
    missing_keys="$missing_keys $key"
    continue
  fi

  if [ "$mode" = "keys-only" ]; then
    continue
  fi

  value="${line#*=}"
  if [ -z "$value" ]; then
    missing_keys="$missing_keys $key"
  fi
done < "$required_file"

if [ -n "$missing_keys" ]; then
  echo "Missing required env keys:${missing_keys}" >&2
  exit 1
fi

echo "Validation passed: $env_file"
