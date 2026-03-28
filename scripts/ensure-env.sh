#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-$(pwd)}
cd "$APP_DIR"

if [ -f .env ]; then
  echo ".env уже существует"
  exit 0
fi

if [ -f .env.example ]; then
  cp .env.example .env
  echo ".env создан из .env.example — проверьте значения"
else
  echo "Предупреждение: .env.example не найден"
fi