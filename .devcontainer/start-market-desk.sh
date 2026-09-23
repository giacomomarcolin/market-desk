#!/usr/bin/env bash

set -euo pipefail
cd /workspaces/market-desk

pid_file="/tmp/market-desk-dev.pid"
log_file="/tmp/market-desk-dev.log"

# Do not start a second server if Market Desk is already reachable on port 3000.
if (echo > /dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  exit 0
fi

# Allow the private GitHub Codespaces forwarded hostname.
if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi

nohup npm run dev -- --hostname 0.0.0.0 --port 3000 > "$log_file" 2>&1 &
echo "$!" > "$pid_file"
