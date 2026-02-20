#!/bin/sh
set -eu

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  printf "infra bootstrap: env file not found: %s\n" "$ENV_FILE" >&2
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "infra bootstrap: required command not found: %s\n" "$1" >&2
    exit 1
  fi
}

require_command curl
require_command node

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

required_keys='
EMQX_DASHBOARD_USERNAME
EMQX_DASHBOARD_PASSWORD
EMQX_BACKEND_MQTT_USERNAME
EMQX_BACKEND_MQTT_PASSWORD
EMQX_AGENT_MQTT_USERNAME
EMQX_AGENT_MQTT_PASSWORD
'

for key in $required_keys; do
  eval "value=\${$key:-}"
  if [ -z "$value" ]; then
    printf "infra bootstrap: required key is blank: %s\n" "$key" >&2
    exit 1
  fi
done

if [ "$EMQX_BACKEND_MQTT_USERNAME" = "$EMQX_AGENT_MQTT_USERNAME" ]; then
  printf "infra bootstrap: backend and agent usernames must be distinct.\n" >&2
  exit 1
fi

API_URL="${EMQX_API_URL:-http://localhost:18083/api/v5}"
AUTHENTICATOR_URL="${API_URL}/authentication/password_based%3Abuilt_in_database"

tmp_response="$(mktemp)"
trap 'rm -f "$tmp_response"' EXIT INT TERM

json_pair() {
  node -e 'const [k1, v1, k2, v2] = process.argv.slice(1); const payload = {}; payload[k1] = v1; payload[k2] = v2; process.stdout.write(JSON.stringify(payload));' "$1" "$2" "$3" "$4"
}

json_user_create() {
  node -e 'const [userId, password] = process.argv.slice(1); process.stdout.write(JSON.stringify({ user_id: userId, password, is_superuser: false }));' "$1" "$2"
}

json_user_update() {
  node -e 'const [password] = process.argv.slice(1); process.stdout.write(JSON.stringify({ password, is_superuser: false }));' "$1"
}

login_payload="$(json_pair username "$EMQX_DASHBOARD_USERNAME" password "$EMQX_DASHBOARD_PASSWORD")"
login_response="$(
  curl -fsS \
    -X POST \
    "${API_URL}/login" \
    -H "content-type: application/json" \
    -d "$login_payload"
)"

token="$(
  node -e 'const response = JSON.parse(process.argv[1]); if (!response.token) process.exit(1); process.stdout.write(response.token);' "$login_response"
)" || {
  printf "infra bootstrap: failed to read EMQX API token from login response.\n" >&2
  exit 1
}

auth_header="Authorization: Bearer ${token}"

authenticator_status="$(
  curl -sS -o "$tmp_response" -w "%{http_code}" \
    "${AUTHENTICATOR_URL}" \
    -H "$auth_header"
)"

if [ "$authenticator_status" -ne 200 ]; then
  printf "infra bootstrap: expected password_based:built_in_database authenticator (HTTP %s).\n" "$authenticator_status" >&2
  cat "$tmp_response" >&2
  exit 1
fi

upsert_user() {
  user_id="$1"
  password="$2"

  create_payload="$(json_user_create "$user_id" "$password")"
  create_status="$(
    curl -sS -o "$tmp_response" -w "%{http_code}" \
      -X POST \
      "${AUTHENTICATOR_URL}/users" \
      -H "$auth_header" \
      -H "content-type: application/json" \
      -d "$create_payload"
  )"

  case "$create_status" in
    200|201)
      printf "infra bootstrap: ensured MQTT user %s.\n" "$user_id"
      return 0
      ;;
    400|409)
      ;;
    *)
      printf "infra bootstrap: failed to create MQTT user %s (HTTP %s).\n" "$user_id" "$create_status" >&2
      cat "$tmp_response" >&2
      return 1
      ;;
  esac

  update_payload="$(json_user_update "$password")"
  update_status="$(
    curl -sS -o "$tmp_response" -w "%{http_code}" \
      -X PUT \
      "${AUTHENTICATOR_URL}/users/${user_id}" \
      -H "$auth_header" \
      -H "content-type: application/json" \
      -d "$update_payload"
  )"

  case "$update_status" in
    200|204)
      printf "infra bootstrap: updated MQTT user %s.\n" "$user_id"
      return 0
      ;;
    *)
      printf "infra bootstrap: failed to update MQTT user %s (HTTP %s).\n" "$user_id" "$update_status" >&2
      cat "$tmp_response" >&2
      return 1
      ;;
  esac
}

upsert_user "$EMQX_BACKEND_MQTT_USERNAME" "$EMQX_BACKEND_MQTT_PASSWORD"
upsert_user "$EMQX_AGENT_MQTT_USERNAME" "$EMQX_AGENT_MQTT_PASSWORD"

printf "infra bootstrap: EMQX authentication users are configured.\n"
