#!/usr/bin/env bash

set -euo pipefail
cd /workspaces/market-desk

pid_file="/tmp/market-desk-dev.pid"
log_file="/tmp/market-desk-dev.log"

if [[ -r "$pid_file" ]] && kill -0 "$(<"$pid_file")" 2>/dev/null; then
  exit 0
fi

# Do not start a second server if a previous start is still listening.
if (echo > /dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  exit 0
fi

nohup npm run dev -- --host 0.0.0.0 > "$log_file" 2>&1 &
echo "$!" > "$pid_file"
