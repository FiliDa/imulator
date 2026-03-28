# 🤖 Cheater Buster API (Node.js, Express)

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat&logo=express&logoColor=white)](https://expressjs.com/)

API‑сервис для краткого анализа текста и скриншотов. Возвращает 1–2 предложения на английском в повелительном наклонении. Есть Swagger‑документация, админ‑панель, логи/статистика и мок‑режим при отсутствии ключа LLM.

## ✨ Возможности
- `POST /api/v1/analyze/text` — текст → короткая инструкция (поддерживает `?plain=true` для `text/plain`)
- `POST /api/v1/analyze/text-image` — текст + изображения (multipart или dataURL JSON) → инструкция
- `POST /api/v1/analyze/image` — изображения → инструкция
- `/docs` — Swagger UI с примерами
- `/admin` — админ‑панель: статус, конфиг, промпт, логи, встроенные тесты (требуются токены)
- Фолбэк‑режим без LLM (детерминированные ответы для демонстрации)

## 🚀 Быстрый старт

1) Установите зависимости:
```bash
npm ci
```
2) Создайте `.env` и задайте базовые переменные:
```ini
PORT=9999
# OPENAI_API_KEY=...       # опционально (LLM); без него будет мок‑режим
# LLM_MODEL=gpt-4o-mini    # опционально
# ADMIN_TOKEN=...          # для админ‑эндпоинтов
# OPERATOR_TOKEN=...       # для чтения логов/статистики
# CORS_ORIGIN=*
# HTTPS_ENABLE=false
# SSL_KEY_PATH=
# SSL_CERT_PATH=
# QWEN_CHAT_URL=...        # опционально: проксирование Qwen
# QWEN_PHOTO_URL=...
# QWEN_USER=...
# QWEN_PASS=...
# QWEN_APP_ID=test
# QWEN_UID=test
```
3) Запуск:
```bash
NODE_ENV=production node src/server.js
# проверка
curl http://localhost:9999/health
```

## 🐳 Docker
```bash
docker compose up -d --build
```
По умолчанию пробрасывается порт, смотрите `docker-compose.yml`.

## 📚 API (сводка)

- `POST /api/v1/analyze/text`
  - body: `{ "text": "...", "context": "..." }`
  - query: `plain=true` → ответ `text/plain`
  - `200: { "result": "..." }` или `text/plain`

- `POST /api/v1/analyze/text-image`
  - multipart: `text`, `context?`, `images[]` (binary)
  - json: `{ "text": "...", "context": "...", "images": ["data:image/...;base64,..."] }`
  - query: `plain=true` → `text/plain`

- `POST /api/v1/analyze/image`
  - multipart: `images[]` (binary), `context?`
  - json: `{ "images": ["data:image/..."], "context": "..." }`
  - query: `plain=true` → `text/plain`

Подробности и примеры — в `/docs` (Swagger).

## 🔐 Админ‑эндпоинты
- Заголовок `x-admin-token` обязателен:
  - `GET /api/v1/admin/config`, `/stats`, `/stats/daily`, `/logs`, `/logs/export`
  - `POST /api/v1/admin/config/update`, `/logs/clear`
  - `GET|PUT|POST /api/v1/admin/prompt`, а также `apply/reset/reload/save`
  - `GET /api/v1/admin/audit`
- Роли:
  - admin — полный доступ (включая `config.update`, `prompt.*`, `logs.clear`)
  - operator — чтение логов/статистики

## ⚙️ Конфигурация
- Файл: [`src/config.js`](src/config.js)
- Ключевые переменные:
  - `PORT`, `OPENAI_API_KEY`, `LLM_MODEL`
  - `ADMIN_TOKEN`, `OPERATOR_TOKEN`
  - `CORS_ORIGIN`
  - `HTTPS_ENABLE`, `SSL_KEY_PATH`, `SSL_CERT_PATH`
  - Qwen прокси: `QWEN_*`

## 🗂 Структура проекта
```
imulator/
├── src/
│   ├── server.js          # Основной сервер, маршруты, /docs, /admin
│   ├── config.js          # Конфиг из .env
│   ├── prompt.js          # Работа с системным промптом
│   ├── services/          # Клиенты OpenAI/Qwen и утилиты
│   ├── validation.js      # Схемы валидации
│   ├── db.js              # Логирование запросов/аудита (опционально)
│   └── swagger.json       # Описание API
├── public/
│   ├── admin.html         # Панель админа
│   └── admin.js
├── Dockerfile, docker-compose.yml
└── README.md
```

## 🛡 Безопасность
- Не храните ключи и токены в репозитории — используйте `.env` (добавьте в .gitignore).
- Для админ‑маршрутов используйте `x-admin-token`.
- В продакшене включайте HTTPS или используйте reverse‑proxy (Nginx).

## 📞 Поддержка
- Swagger: `/docs`
- Health: `/health`
- Админ‑панель: `/admin`

Автор: Filippov D.A. — Backend Engineer
