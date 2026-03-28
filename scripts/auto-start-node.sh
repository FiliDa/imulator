#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/cheater-buster}
PORT=${PORT:-3000}

mkdir -p "$APP_DIR"
cd "$APP_DIR"

"$(dirname "$0")/ensure-node.sh"
"$(dirname "$0")/ensure-env.sh"

if [ -f package.json ]; then
  npm ci --omit=dev
else
  echo "package.json не найден — убедитесь, что проект скопирован в $APP_DIR"
  exit 1
fi

echo "Запускаю сервер на порту ${PORT}"
exec node src/server.js