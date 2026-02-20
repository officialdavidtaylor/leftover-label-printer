#!/usr/bin/env bash
set -euo pipefail

QUEUE_NAME="${QUEUE_NAME:-dymo}"
MODEL_HINT="${MODEL_HINT:-LabelWriter 450}"

log() {
  printf '[dymo-setup] %s\n' "$*"
}

die() {
  printf '[dymo-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "$(uname -s)" != "Linux" ]]; then
  die "This script must run on a Linux host (for example Raspberry Pi OS)."
fi

if [[ "${EUID}" -ne 0 ]]; then
  die "Run this script with sudo: sudo $0"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "apt-get was not found. This script currently supports Debian-based hosts only."
fi

export DEBIAN_FRONTEND=noninteractive

log "Refreshing apt package metadata"
apt-get update -y

packages=(cups cups-client)

if apt-cache show printer-driver-dymo >/dev/null 2>&1; then
  packages+=(printer-driver-dymo)
elif apt-cache show printer-driver-all >/dev/null 2>&1; then
  packages+=(printer-driver-all)
else
  die "Could not find printer-driver-dymo (or fallback printer-driver-all) in apt repositories."
fi

log "Installing packages: ${packages[*]}"
apt-get install -y "${packages[@]}"

if command -v systemctl >/dev/null 2>&1; then
  log "Ensuring cups service is enabled"
  systemctl enable --now cups
fi

if ! command -v lpinfo >/dev/null 2>&1 || ! command -v lpadmin >/dev/null 2>&1; then
  die "CUPS commands (lpinfo/lpadmin) are not available after package install."
fi

usb_uri="$(lpinfo -v | awk '/^direct usb:\/\/.*(DYMO|Dymo|dymo)/ {print $2; exit}')"
if [[ -z "$usb_uri" ]]; then
  usb_uri="$(lpinfo -v | awk '/^direct usb:\/\/.*LabelWriter/ {print $2; exit}')"
fi

if [[ -z "$usb_uri" ]]; then
  die "No DYMO USB printer was detected. Plug in the LabelWriter 450 and rerun."
fi

model_name="$(lpinfo -m | awk -v hint="$MODEL_HINT" 'BEGIN{IGNORECASE=1} $0 ~ hint {print $1; exit}')"
if [[ -z "$model_name" ]]; then
  model_name="$(lpinfo -m | awk 'BEGIN{IGNORECASE=1} /DYMO/ && /LabelWriter/ {print $1; exit}')"
fi

if [[ -z "$model_name" ]]; then
  die "Could not find a DYMO LabelWriter model in CUPS."
fi

if lpstat -p "$QUEUE_NAME" >/dev/null 2>&1; then
  log "Updating existing CUPS queue '$QUEUE_NAME'"
else
  log "Creating CUPS queue '$QUEUE_NAME'"
fi

lpadmin -p "$QUEUE_NAME" -E -v "$usb_uri" -m "$model_name"
cupsenable "$QUEUE_NAME"
cupsaccept "$QUEUE_NAME"
lpoptions -d "$QUEUE_NAME"

log "Queue '$QUEUE_NAME' is configured with model '$model_name' and URI '$usb_uri'"
log "Validation command: lpstat -p '$QUEUE_NAME' -l"
