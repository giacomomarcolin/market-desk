#!/usr/bin/env bash

set -euo pipefail
cd /workspaces/market-desk

# Do not start a second server if Market Desk is already responding on port 3000.
if curl --fail --silent --max-time 2 http://127.0.0.1:3000/ >/dev/null 2>&1; then
  exit 0
fi

# Allow the private GitHub Codespaces forwarded hostname.
if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi

exec npm run dev -- --hostname 0.0.0.0 --port 3000
