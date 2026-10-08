# Памятка: как запустить

Все команды выполняются из корня репозитория.

## 1. Веб-версия через Docker (самый простой путь)

Нужны: Docker Desktop (с Compose), Git.

```bash
cp .env.example .env
```

Откройте `.env` и задайте **свои** значения (примеры из файла не используйте):
- `POSTGRES_PASSWORD` — пароль базы;
- `SESSION_SECRET` — случайная строка не короче 32 символов (`openssl rand -hex 32`);
- `DEMO_PASSWORD` — пароль демо-пользователей.

```bash
docker compose up --build
```

Откройте http://localhost:3000 и войдите:
- `director@monolit.local` — директор, видит все объекты;
- `manager@monolit.local` — руководитель проекта;
- пароль — значение `DEMO_PASSWORD` из `.env`.

Миграции и демо-данные загружаются автоматически при первом старте. Остановить: `docker compose down` (данные сохраняются в томе). Полный сброс данных: `docker compose down -v`.

## 2. Без Docker (для разработки)

Нужны: Node.js 24, PostgreSQL 16.

```bash
npm ci
cp .env.example .env         # задайте DATABASE_URL и остальные значения
npm run db:migrate
npx tsx --env-file=.env scripts/seed.ts
npm run dev                  # http://localhost:3000
```

## 3. Проверки

```bash
npm run typecheck
npm run lint
npm run build
npm run test:db:up           # нужен Docker: тестовая БД PostgreSQL 16
npm test                     # все интеграционные тесты
npm run test:sync            # только сценарии офлайн-синхронизации
```

Сквозная проверка API против работающего сервера (при запущенном `docker compose up`):

```bash
DEMO_PASSWORD=<значение из .env> npx tsx --env-file=.env scripts/smoke.ts
```

## 4. Десктоп-клиент для Windows

Нужны: Windows 10/11, Node.js 24. Для работы десктопа нужен сервер из п. 1.

```bash
npm ci
npm run dist                 # → dist-desktop/ERP-Энерготех-Setup.exe
```

Запуск без установки для разработки:

```bash
npm run desktop:dev          # данные — %APPDATA%\ERP-Energotech
```

При первом запуске укажите адрес сервера (для локального — `http://localhost:3000`), email и пароль. `http://` разрешён только для `localhost`; для других серверов нужен `https://`.

Проверка сборки на секреты:

```bash
node scripts/check-desktop-package.mjs
```

E2E-тесты десктопа (при запущенном сервере из п. 1):

```bash
npx playwright test e2e/desktop.spec.ts e2e/offline.spec.ts
```

## 5. Частые проблемы

- **`POSTGRES_PASSWORD is required` / `SESSION_SECRET is required`** — не создан `.env` или не заполнены поля (см. п. 1).
- **Порт 3000 или 54329 занят** — остановите мешающую программу или измените порт в `docker-compose.yml`.
- **«Требуется версия протокола»** в десктопе — обновите приложение до той же версии, что и сервер.
- **«Нужна связь с сервером»** — ожидаемо для операций «только онлайн» (согласование, объекты, справочники) без подключения к серверу.
- **SmartScreen при установке** — установщик не подписан; «Подробнее» → «Выполнить в любом случае».
- Журналы десктопа: `%APPDATA%\ERP-Energotech\logs`.
