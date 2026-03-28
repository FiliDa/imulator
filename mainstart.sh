#!/usr/bin/env bash
set -euo pipefail

# mainstart.sh — единый старт для Ubuntu/Debian
# — Проверяет наличие node/npm/curl
# — Создаёт .env при отсутствии (или копирует из .env.example)
# — Устанавливает зависимости (npm ci / npm install)
# — Опционально подтягивает sqlite3 (--sqlite)
# — Запускает сервер в production и перезапускает при падении

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

FORCE_INSTALL=false
INSTALL_SQLITE=false
PORT_OVERRIDE=""
ENABLE_HTTPS=true

usage() {
  cat <<'USAGE'
Использование: ./mainstart.sh [опции]
  --force            принудительно установить зависимости (npm ci / npm install)
  --sqlite           попытаться установить optional sqlite3 (--no-save)
  --port N           запустить на порту N и обновить .env
  --https            включить HTTPS (самоподписанный сертификат, на том же порту)
  --no-https         отключить HTTPS (форсировать HTTP)
  -h, --help         показать справку
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --force)   FORCE_INSTALL=true; shift ;;
    --sqlite)  INSTALL_SQLITE=true; shift ;;
    --port)    PORT_OVERRIDE="$2"; shift 2 ;;
    --port=*)  PORT_OVERRIDE="${1#*=}"; shift ;;
    --https)   ENABLE_HTTPS=true; shift ;;
    --no-https) ENABLE_HTTPS=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) shift ;;
  esac
done

log_info() { echo -e "\033[36m[mainstart]\033[0m $*"; }
log_ok()   { echo -e "\033[32m[ok]\033[0m $*"; }
log_warn() { echo -e "\033[33m[warn]\033[0m $*"; }
log_err()  { echo -e "\033[31m[err]\033[0m $*"; }

# Утилита для установки пакетов, если доступны apt/apt-get
ensure_pkg() {
  local pkg="$1"
  if command -v "$pkg" >/dev/null 2>&1; then return 0; fi
  if command -v apt-get >/dev/null 2>&1; then
    log_info "Устанавливаю пакет $pkg через apt-get…"
    if [ "$EUID" -ne 0 ]; then sudo apt-get update -y || true; else apt-get update -y || true; fi
    if [ "$EUID" -ne 0 ]; then sudo apt-get install -y "$pkg" || true; else apt-get install -y "$pkg" || true; fi
  fi
}

# Проверка node/npm
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  log_warn "Node.js/npm не найдены. Пытаюсь установить Node.js 18+…"
  ensure_pkg curl
  if command -v apt-get >/dev/null 2>&1; then
    if [ "$EUID" -ne 0 ]; then
      curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - || true
      sudo apt-get install -y nodejs || true
    else
      curl -fsSL https://deb.nodesource.com/setup_18.x | bash - || true
      apt-get install -y nodejs || true
    fi
  fi
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    log_err "Node.js/npm не удалось установить автоматически. Установите вручную и повторите."
    exit 1
  fi
fi

# Проверка curl/openssl (и установка при наличии apt)
ensure_pkg curl
ensure_pkg openssl
if ! command -v curl >/dev/null 2>&1; then
  log_err "curl не найден и не удалось установить."; exit 1; fi
if ! command -v openssl >/dev/null 2>&1 && [ "$ENABLE_HTTPS" = true ]; then
  log_warn "openssl не найден — отключаю HTTPS"; ENABLE_HTTPS=false
fi

########################################
# Подготовка .env (дефолтный порт 3000)
########################################
if [ ! -f .env ]; then
  log_warn ".env не найден — создаю из .env.example (если есть) или минимальный."
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    cat > .env << 'EOF'
PORT=3000
ADMIN_TOKEN=
OPERATOR_TOKEN=
OPENAI_API_KEY=
LLM_MODEL=gpt-4o-mini
CORS_ORIGIN=*
EOF
  fi
  log_ok ".env готов."
fi

# Если PORT не задан — добавить 3000
if ! grep -q '^PORT=' .env 2>/dev/null; then
  log_info "PORT не задан — добавляю PORT=3000 в .env"
  echo "PORT=3000" >> .env
fi

# Если указан --port, обновить/дописать PORT в .env
if [ -n "$PORT_OVERRIDE" ]; then
  if grep -q '^PORT=' .env 2>/dev/null; then
    sed -i "s/^PORT=.*/PORT=${PORT_OVERRIDE}/" .env || true
  else
    echo "PORT=${PORT_OVERRIDE}" >> .env
  fi
  log_ok "PORT принудительно установлен: ${PORT_OVERRIDE}"
fi

# Если включили HTTPS — добавим переменные окружения в .env
if [ "$ENABLE_HTTPS" = true ]; then
  mkdir -p certs
  # Генерируем самоподписанный сертификат, если его нет
  if [ ! -f certs/server.key ] || [ ! -f certs/server.crt ]; then
    if command -v openssl >/dev/null 2>&1; then
      log_info "Генерирую самоподписанный сертификат (openssl)…"
      openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/server.key -out certs/server.crt -days 365 -subj "/CN=$(hostname -f 2>/dev/null || echo localhost)" || {
        log_warn "Не удалось сгенерировать сертификат — продолжу без HTTPS"; ENABLE_HTTPS=false; 
      }
    else
      log_warn "openssl не установлен — HTTPS недоступен. Установите: sudo apt-get install -y openssl"; ENABLE_HTTPS=false
    fi
  fi
  if [ "$ENABLE_HTTPS" = true ]; then
    # Пропишем переменные в .env
    sed -i '/^HTTPS_ENABLE=/d' .env || true
    sed -i '/^SSL_KEY_PATH=/d' .env || true
    sed -i '/^SSL_CERT_PATH=/d' .env || true
    {
      echo "HTTPS_ENABLE=true"
      echo "SSL_KEY_PATH=./certs/server.key"
      echo "SSL_CERT_PATH=./certs/server.crt"
    } >> .env
    log_ok "HTTPS включён: использую certs/server.crt и certs/server.key"
  fi
fi

# Установка зависимостей
NEED_INSTALL=$FORCE_INSTALL
if [ ! -d node_modules ]; then
  NEED_INSTALL=true
fi

if [ "$NEED_INSTALL" = true ]; then
  log_info "Устанавливаю зависимости…"
  if [ -f package-lock.json ]; then
    if ! npm ci; then
      log_warn "npm ci не удалось, пробую npm install"
      npm install --omit=dev
    fi
  else
    npm install --omit=dev
  fi
  log_ok "Зависимости установлены."
else
  log_info "node_modules найден — пропускаю установку (используйте --force для принудительной)."
fi

# Опционально: sqlite3 (без записи в package.json)
if [ "$INSTALL_SQLITE" = true ] && [ ! -d node_modules/sqlite3 ]; then
  log_info "Подтягиваю optional sqlite3 (--no-save)…"
  if ! npm install sqlite3 --no-save; then
    log_warn "sqlite3 не установился (возможно требуются build tools: sudo apt-get install -y build-essential python3 make g++)."
  else
    log_ok "sqlite3 установлен."
  fi
fi

# Определяем порт
PORT=3000
if grep -q '^PORT=' .env 2>/dev/null; then
  PORT=$(grep '^PORT=' .env | head -n1 | cut -d '=' -f2 | tr -d '"' | xargs)
fi
if [ -n "$PORT_OVERRIDE" ]; then PORT="$PORT_OVERRIDE"; fi

# Узнаем, включён ли HTTPS через .env
if grep -q '^HTTPS_ENABLE=\s*true' .env 2>/dev/null; then ENABLE_HTTPS=true; fi

########################################
# Стартуем Node в фоне и пробуем эндпоинты
########################################
probe_endpoints() {
  local scheme="http"
  [ "$ENABLE_HTTPS" = true ] && scheme="https"
  local base="${scheme}://127.0.0.1:${PORT}"
  # Ждём готовности /health до 30 сек
  local deadline=$(( $(date +%s) + 30 ))
  local ok=0
  while [ $(date +%s) -lt $deadline ]; do
    if curl -s -m 2 ${ENABLE_HTTPS:+-k} "$base/health" 2>/dev/null | grep -q '"status"\s*:\s*"ok"'; then
      ok=1; break
    fi
    sleep 0.5
  done
  if [ "$ok" -eq 1 ]; then
    log_ok "Health OK"
  else
    log_warn "Health не ответил за 30 сек — проверьте логи."
  fi
  # Проверяем /docs и ключевые ассеты
  code=$(curl -s -L ${ENABLE_HTTPS:+-k} -o /dev/null -w "%{http_code}" "$base/docs")
  if echo "$code" | grep -qE '^(200|304)$'; then
    log_ok "/docs доступен"
  else
    log_warn "/docs недоступен (HTTP $code)"
  fi
  for a in swagger-ui.css swagger-ui-bundle.js favicon-32x32.png; do
    code=$(curl -s ${ENABLE_HTTPS:+-k} -o /dev/null -w "%{http_code}" "$base/docs/$a")
    if echo "$code" | grep -qE '^(200|304)$'; then
      log_ok "/docs/$a: $code"
    else
      log_warn "Асет $a недоступен по HTTP (код $code). Если браузер форсирует HTTPS — очистите HSTS/принудительный HTTPS."
    fi
  done
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -z "$LOCAL_IP" ] && LOCAL_IP="<ваш_IP>"
  local schemeOut="http"; [ "$ENABLE_HTTPS" = true ] && schemeOut="https"
  log_info "Откройте: ${schemeOut}://localhost:${PORT}/docs (или ${schemeOut}://${LOCAL_IP}:${PORT}/docs)"
}

start_server() {
  set +e
  if [ "$ENABLE_HTTPS" = true ]; then
    NODE_ENV=production HTTPS_ENABLE=true SSL_KEY_PATH=./certs/server.key SSL_CERT_PATH=./certs/server.crt PORT="$PORT" node src/server.js &
  else
    NODE_ENV=production PORT="$PORT" node src/server.js &
  fi
  PID=$!
  set -e
  log_info "Node PID: ${PID}"
  probe_endpoints
}

cleanup() {
  log_warn "Получен сигнал завершения — останавливаю Node PID=${PID}…"
  if [ -n "${PID:-}" ]; then kill "$PID" 2>/dev/null || true; fi
  exit 0
}
trap cleanup INT TERM

log_info "Запускаю сервер на порту $PORT… (Ctrl+C для остановки)"
echo
start_server

# Keep-alive цикл: ждём завершения и перезапускаем
while true; do
  wait ${PID}
  CODE=$?
  if [ "$CODE" -eq 0 ]; then
    log_warn "Сервер завершился с кодом 0. Перезапуск через 2 сек…"
  else
    log_err "Сервер завершился с кодом $CODE. Перезапуск через 2 сек…"
  fi
  sleep 2
  start_server
done