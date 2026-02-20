#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
VALIDATOR="$ROOT_DIR/scripts/env/validate_env.sh"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

required_file="$workdir/required.txt"
cat > "$required_file" <<'REQ'
REQUIRED_ONE
REQUIRED_TWO
REQ

optional_file="$workdir/required-optional.txt"
cat > "$optional_file" <<'REQ'
REQUIRED_ONE
REQ

cat > "$workdir/pass.env" <<'ENV'
REQUIRED_ONE=1
REQUIRED_TWO=2
OPTIONAL_THREE=
ENV

cat > "$workdir/missing.env" <<'ENV'
REQUIRED_ONE=1
ENV

cat > "$workdir/empty.env" <<'ENV'
REQUIRED_ONE=1
REQUIRED_TWO=
ENV

"$VALIDATOR" "$required_file" "$workdir/pass.env"

if "$VALIDATOR" "$required_file" "$workdir/missing.env"; then
  echo "expected missing required key validation to fail" >&2
  exit 1
fi

if "$VALIDATOR" "$required_file" "$workdir/empty.env"; then
  echo "expected empty required value validation to fail" >&2
  exit 1
fi

"$VALIDATOR" --keys-only "$required_file" "$workdir/empty.env"
"$VALIDATOR" "$optional_file" "$workdir/pass.env"

echo "env validation tests passed"
