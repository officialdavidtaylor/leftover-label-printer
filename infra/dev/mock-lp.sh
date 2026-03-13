#!/bin/sh

set -eu

artifact_dir="${MOCK_PRINT_ARTIFACT_DIR:-/var/lib/leftover-agent/mock-artifacts}"
fail_marker="${MOCK_PRINT_FAIL_MARKER:-[mock-fail]}"
printer_name=""
pdf_path=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -d)
      shift
      printer_name="${1:-}"
      ;;
    *)
      pdf_path="$1"
      ;;
  esac
  shift || true
done

if [ -z "$pdf_path" ]; then
  echo "mock-lp: missing PDF path" >&2
  exit 1
fi

mkdir -p "$artifact_dir"

base_name="$(basename "$pdf_path")"
job_id="$(printf '%s\n' "$base_name" | sed -E 's/^job-(.+)-[^-]+\.pdf$/\1/')"
if [ "$job_id" = "$base_name" ]; then
  job_id="unknown-job"
fi

artifact_path="$artifact_dir/$job_id.pdf"
metadata_path="$artifact_dir/$job_id.json"

cp "$pdf_path" "$artifact_path"
chmod 0644 "$artifact_path"

outcome="printed"
error_message=""
if grep -a -F -q -- "$fail_marker" "$pdf_path"; then
  outcome="failed"
  error_message="mock fail marker detected in rendered PDF"
fi

cat >"$metadata_path" <<EOF
{
  "jobId": "$job_id",
  "printerName": "$printer_name",
  "artifactPath": "$artifact_path",
  "outcome": "$outcome",
  "errorMessage": "$error_message"
}
EOF
chmod 0644 "$metadata_path"

if [ "$outcome" = "failed" ]; then
  echo "mock print failed for $job_id: $error_message" >&2
  exit 1
fi

printf 'request id is mock-%s\n' "$job_id"
