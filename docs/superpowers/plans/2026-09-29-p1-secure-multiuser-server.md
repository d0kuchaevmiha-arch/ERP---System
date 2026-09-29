# P1 — Безопасный многопользовательский сервер: план реализации

- **Спецификация:** `docs/superpowers/specs/2026-09-29-desktop-offline-sync-design.md`, §4.1 (users), §4.2 (`login_attempts`), §5.2, §11, §12 (P1).
- **Статус:** черновик, ждёт «ок».
- **Критерии приёмки P1 (§12):** тесты изоляции и гонок зелёные; без входа данные не отдаются; `docker compose up` (dev) работает; typecheck / lint / build / smoke зелёные.

## 0. Что обнаружено при чтении кода (проверено)

| # | Факт | Где |
|---|---|---|
| F1 | `getOverview()` читает все таблицы без фильтра организации/доступа; уведомления всех пользователей и последние 40 записей аудита отдаются всем | `src/lib/overview.ts` |
| F2 | `GET /api/v1/<resource>` фильтрует результат `getOverview()` — утечка та же | `route.ts` GET |
| F3 | `ERP_PRIVATE_MODE` по умолчанию `false` в docker-compose; `page.tsx` читает overview **до** проверки входа | `docker-compose.yml`, `src/app/page.tsx`, `src/app/projects/[id]/page.tsx` |
| F4 | `project_access` проверяется только при наличии `projectId` во входе: `progress`, `approvals`, `receive`, `movements` (склад объекта) обходят проверку доступа | `route.ts` POST |
| F5 | Ссылки на чужие сущности не проверяются: `tasks.parentId`, `budgets/expenses.taskId`, `expenses.contractId/counterpartyId`, `contracts.counterpartyId`, `purchases.warehouseId/supplierId`, `movements.taskId` | `route.ts` POST |
| F6 | Гонки: approvals — SELECT → UPDATE без условия; receive — чтение `receivedQuantity` без блокировки, сравнение через `Number` | `route.ts` |
| F7 | `String(input.actualQuantity \|\| old.actualQuantity)` — 0 записать нельзя | `route.ts` progress |
| F8 | `SESSION_SECRET` с фолбэком на `DEMO_PASSWORD` и на `'development-only-secret'`; сессия не проверяет блокировку, нет отзыва | `src/lib/session.ts` |
| F9 | Счётчик попыток входа в `Map` процесса; `X-Forwarded-For` берётся без проверки | `src/app/api/auth/route.ts` |
| F10 | Миграций нет, контейнер делает `drizzle-kit push` при каждом старте | `Dockerfile` |
| F11 | Тестов и тест-раннера нет; `node_modules` не установлены; **git-репозитория нет** | корень |

## 1. Решения внутри P1 (рекомендуемые; альтернативы — в скобках)

1. **Тест-раннер — Vitest** (альт.: `node:test` + tsx — без зависимости, но хуже с алиасами `@/` и параллелизмом). Только devDependency, стек не меняется.
2. **Тестовая БД — сервис `db-test` в `docker-compose.yml` под `profiles: [test]`** (PostgreSQL 16, `127.0.0.1:54329`, tmpfs). Обычный `docker compose up` его не запускает. Каждый тестовый файл создаёт свою БД `t_<rand>`, применяет миграции, удаляет её в конце. (альт.: testcontainers — лишняя зависимость.)
3. **Тестируемость без `next/headers`:** логика сессии — чистые функции (`verifySessionToken(token, db)`), логика записи — `runCommand(ctx, name, input)`; route handlers становятся тонкими. HTTP-уровень проверяет `scripts/smoke.ts` против docker compose.
4. **Baseline:** `0000_baseline.sql` генерируется из **текущей** `schema.ts` без изменений. Скрипт миграции: если есть таблица `organizations`, но нет `drizzle.__drizzle_migrations` → проверить, что все таблицы/колонки из 0000 существуют (information_schema), и только тогда записать 0000 как применённую; при расхождении — остановка с понятным сообщением, данные не трогаются.
5. **Формат сессии:** `userId.sessionVersion.expires.hmac`. Старые cookie станут недействительны → всем один раз войти заново (допустимо до выхода в сеть).
6. **Граница P1/P2 по доменному слою** — см. «Вопрос» в конце; план ниже написан под рекомендуемый вариант A.

## 2. Шаги (каждый оставляет систему рабочей)

После **каждого** шага: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (unit + integration на `db-test`), коммит.

### Шаг 0. Подготовка
- `git init`, первый коммит «как есть» (`.env` уже в `.gitignore`; добавить `Claude outputs/`, `*.pdf` в корне — уточню при коммите).
- `npm install`; зафиксировать, что typecheck/lint/build проходят **до** изменений (если нет — отчитаюсь отдельно, не чиню молча).
- Vitest + `vitest.config.ts` (алиас `@/`, `fileParallelism` для integration — по БД на файл), скрипты `test`, `test:unit`, `test:int`, `db:generate`, `db:migrate`.
- `db-test` в compose (profile test), хелпер `test/db.ts` (создать/мигрировать/удалить БД, фабрики: организация, пользователь с ролью, объект, доступ).

### Шаг 1. Версионные миграции + baseline
- Тесты (красные): (а) пустая БД → все миграции применяются; (б) БД, созданная «как push» (SQL 0000 без журнала) с данными → baseline, данные целы, повторный запуск — no-op; (в) БД с расхождением схемы → ошибка, ничего не изменено.
- `drizzle-kit generate` → `drizzle/0000_baseline.sql`; `src/server/db/migrate.ts` (drizzle `migrator` + baseline); `scripts/migrate.ts`.
- `Dockerfile`: `drizzle-kit push` → `tsx scripts/migrate.ts`; seed пока остаётся при старте dev-контейнера (в prod-compose P5 — отдельной командой, §9).
- README/development.md: `push` заменён на `npm run db:migrate`.

### Шаг 2. Пользователи: поля + сессии
- Миграция `0001`: `users.is_active bool default true`, `session_version int default 1`, `must_change_password bool default false`, `password_changed_at timestamptz null`; таблица `login_attempts`.
- Тесты: токен с подменой подписи/истёкший → null; `is_active=false` → null; `session_version` увеличен → старый токен null; без `SESSION_SECRET` (или < 32 символов) → сервер отказывает, фолбэков нет.
- `src/lib/session.ts` → `src/server/auth/session.ts` (реэкспорт по старому пути, чтобы UI не ломался).

### Шаг 3. Rate limit входа в БД + доверенный прокси
- Тесты: 10 неудач по ключу email+ip → 429 даже с «другого экземпляра» (новое соединение); успех сбрасывает; окно 15 мин истекает; `X-Forwarded-For` игнорируется без `TRUSTED_PROXY`.
- `src/server/auth/rate-limit.ts` (UPSERT в `login_attempts`), `src/server/http/client-ip.ts`; тот же IP-хелпер для `audit_logs.ip`.

### Шаг 4. Каркас доменного слоя, перенос записи 1:1
- Характеризационные тесты текущего поведения каждой команды (успех + основные ошибки) — **до** переноса.
- `src/server/domain/{context,errors,authz}.ts`, `src/server/domain/commands/<name>.ts` (`name`, `schema`, `authorize`, `execute`), реестр; `POST /api/v1/[resource]` → `runCommand`. Поведение и HTTP-контракт не меняются, smoke зелёный.
- Ошибки типизированы: `ValidationError 422`, `Forbidden 403`, `NotFound 404`, `Conflict 409`, `BusinessRule 400`.

### Шаг 5. `authorize` — всегда (§5.2.3) + ссылочная целостность внутри организации
- Тесты изоляции записи (красные на текущем коде): прораб без доступа меняет прогресс чужой работы → 403; `view`-доступ → 403; решение/приёмка заявки чужого объекта → 403; движение на склад чужого объекта → 403; пользователь орг. X ссылается на задачу/договор/контрагента/склад орг. Y → 404; `read_only` → 403 на всё.
- Каждая команда выводит `projectId` из сущности: progress ← task, approvals/receive ← purchase, movements ← склад (или вход, если склад общий), tasks.parentId/budget.taskId/expense.taskId — того же объекта.

### Шаг 6. Гонки и корректность (§5.2.4–5.2.5)
- Тесты (параллельно, `Promise.all` на отдельных соединениях): 2 × approve → ровно 1 успех, второй 409 «уже решено ‹кем›»; 2 × receive, сумма > заказа → принято не больше заказа; 2 × issue последних 10 ед. → 1 успех; progress с `actualQuantity: 0` сохраняет 0.
- approvals: `UPDATE … WHERE status='pending' RETURNING`; receive: `SELECT … FOR UPDATE` + сравнение в NUMERIC (SQL), не `Number`; progress: `??` + `FOR UPDATE` по задаче; проверка превышения бюджета — сравнение в SQL.

### Шаг 7. Чтение только своего (§5.2.1–5.2.2)
- Тесты (красные): пользователь орг. X не видит объекты/справочники/людей орг. Y; прораб видит только объекты с `project_access`; директор/super_admin — все объекты своей орг.; уведомления — только свои; аноним → overview 401, страницы без данных.
- `getOverview(user)` с фильтрами; `GET /api/v1/*` и страницы используют его; в `page.tsx`/`projects/[id]` сначала вход, потом данные.
- `ERP_PRIVATE_MODE`: по умолчанию `true` (код + compose + .env.example); в `ERP_MODE=server` без входа данных нет независимо от флага.

### Шаг 8. Управление пользователями — сервер
- Команды: `users.create`, `users.update` (имя, роль, блокировка), `users.resetPassword` (временный пароль показывается один раз, `must_change_password=true`, `session_version+1`), `access.set` / `access.remove` (view/edit по объекту), `auth.changePassword` (старый+новый, `session_version+1`, новая cookie).
- API: `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`, `PUT/DELETE /api/admin/users/:id/access/:projectId`, `POST /api/auth/password`. Всё с аудитом.
- Флаг `must_change_password`: все API, кроме `/api/auth*`, отвечают 403 `password_change_required`.
- Тесты: права (кто может), блокировка мгновенно рвёт сессию, нельзя заблокировать/понизить себя и последнего администратора, пользователи чужой орг. недоступны.

### Шаг 9. Управление пользователями — UI
- Экран «Пользователи» (список, создать, роль, доступы к объектам, блокировка, сброс пароля), экран смены пароля при входе, экран «Требуется вход» без данных. В стиле `src/components/erp/*`.
- Проверка вручную в браузере (preview) + typecheck/lint/build.

### Шаг 10. Приёмка P1
- `docker compose up --build`: (а) на новом volume; (б) на **существующем** volume, созданном `push` (baseline, данные целы).
- `scripts/smoke.ts` (+ проверки: аноним → 401, прораб без доступа → 403).
- Обновить: `docs/api.md`, `database.md`, `permissions.md`, `deployment.md`, `backup.md`, `development.md`, `README.md`, `CHANGELOG.md` (0.2.0); допущения — в §14 спецификации.
- Отчёт: свежий вывод проверок, что не проверено, риски.

## 3. Допущения P1 (внести в §14 после «ок»)

| Вопрос | Допущение |
|---|---|
| Кто управляет пользователями | `super_admin` и `director` своей организации; назначать `super_admin` может только `super_admin` |
| Политика пароля | ≥ 10 символов; временный пароль — 16 случайных символов |
| Видимость справочников | materials, counterparties, warehouses — вся организация (как §6.3); остатки считаются по всем движениям организации |
| Движения/договоры без объекта | видны всем в организации (движения) / только director, super_admin, finance_manager, accountant (договоры) |
| Журнал аудита в UI | director/super_admin — вся организация; остальные — только свои действия |
| Реальный IP клиента | Next route handler не видит адрес сокета; при `TRUSTED_PROXY=1` берётся крайний правый `X-Forwarded-For`, иначе ключ лимита — только email |
| Срок сессии | 7 дней (как сейчас) |

## 4. Риски
- Существующий volume мог быть создан из другой версии схемы → baseline откажет; тогда нужна разовая ручная сверка (не автоматическое «исправление»).
- `Number` в агрегатах overview (отображение) остаётся до P2 — источник истины (БД, проверки) переводится на NUMERIC в SQL.
- UI-экраны проверяются вручную, E2E-тестов в P1 нет (Playwright — P3/P4).
