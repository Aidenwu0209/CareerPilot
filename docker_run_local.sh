#!/usr/bin/env bash
set -euo pipefail

docker rm -f careerpilot 2>/dev/null || true

docker build -t careerpilot .

docker run -d --name careerpilot -p 3003:3000 \
  -e AUTH_SECRET="${AUTH_SECRET:-change-me-in-production}" \
  -v "$(pwd)/careerpilot-data:/app/data" \
  careerpilot
