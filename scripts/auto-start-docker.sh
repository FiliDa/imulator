#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/cheater-buster}

mkdir -p "$APP_DIR"
cd "$APP_DIR"

"$(dirname "$0")/ensure-docker.sh"
"$(dirname "$0")/ensure-env.sh"

echo "Поднимаю docker compose"
exec docker compose up -d --build