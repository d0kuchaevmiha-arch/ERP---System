# Разработка и проверки

`npm ci`; задать DATABASE_URL и SESSION_SECRET (≥ 32 символов) в `.env`; `npm run db:migrate` (версионные миграции; `drizzle-kit push` не использовать, изменения схемы — правка `src/db/schema.ts` → `npm run db:generate` → ревью SQL в `drizzle/`); `npx tsx --env-file=.env scripts/seed.ts`; `npm run dev`.

## Проверки (после каждого изменения)
- `npm run typecheck`, `npm run lint`, `npm run build`;
- `npm run test:db:up` (один раз; PostgreSQL 16 в памяти на 127.0.0.1:54329, профиль `test`), затем `npm test`. Каждый тестовый файл создаёт свою БД и применяет миграции; моков БД нет;
- HTTP smoke против запущенного compose: `npx tsx --env-file=.env scripts/smoke.ts` — (плюс с 0.3.0: сигнал SSE второму пользователю ≤ 5 с с замером, повтор с `Idempotency-Key` без дубля, закрытие SSE при блокировке) аноним → 401; проект → бюджет → работа → заявка → согласование (+ повтор → 409) → приёмка → списание → прогресс → расход → план/факт → аудит → отказ при дефиците → создание пользователя → временный пароль → смена → нет доступа (403) → выдача доступа → блокировка. Тестовые записи остаются в demo-БД.

## Как добавить операцию записи
1. Файл `src/server/domain/commands/<сущность>-<действие>.ts` через `defineCommand`: `name`, `offline` (политика §5.1 спецификации), `roles`, Zod-`schema`, `authorize` (организация + `project_access`: используйте `requireProjectWrite`, `org*`-поиск и `requireTaskOfProject` из `authz.ts`), `execute`:
   - запись + `audit(tx, ctx, …)`;
   - для каждой изменённой строки — `changed(ctx, '<таблица>', id, projectId | null)` (иначе другие пользователи не увидят изменение, а P3 не отдаст его в pull);
   - факты (расходы, движения, заявки и т. п.) — с `...factFields(ctx)` (происхождение);
   - UPDATE изменяемой строки — с `...bump(table.version)`; если пользователь правит то, что видел, — принять `version: expectedVersion` и вызвать `requireVersion`.
   Идемпотентность, `change_log` и NOTIFY делает `runCommand` — в командах ничего дополнительно не нужно.
2. Зарегистрировать в `registry.ts` (и в `httpCommands`, если нужен POST `/api/v1/<resource>`).
3. Тест в `test/` на настоящей БД: права, изоляция, бизнес-правило.

Деньги и количества сравнивать и складывать в NUMERIC на стороне БД; `Number` — только для отображения. Известный долг: агрегаты сводки (`src/server/read/overview.ts`) считаются в JS и без пагинации — вынести в SQL при росте данных.

## Десктоп (0.4.0)
- Код оболочки — `desktop/src` (main, preload, sync-agent, управление PostgreSQL), экраны запуска — `desktop/ui`, клиентская логика — `src/client` (реплика, sync-agent, режим `ERP_MODE=client`).
- `npm run desktop:dev` — сборка и запуск из репозитория; `npm run dist` — установщик; `node scripts/check-desktop-package.mjs` — проверка сборки на секреты.
- E2E: `npx playwright test e2e/desktop.spec.ts` (нужен `docker compose up`); собранная программа — `E2E_APP=...`; установщик — `E2E_INSTALLER=1 npx playwright test e2e/installed.spec.ts`.
- Оценка объёма реплики по серверной БД: `docker compose exec app npx tsx scripts/estimate-replica.ts`.
- Осторожно, Node 24 на Windows: `fs.rmSync` молча не удаляет, `fs.cpSync` молча завершает процесс на путях с кириллицей (папка проекта «ERP - Энерготех», профиль пользователя). Используйте `desktop/src/fsx.ts`.
- Путь к бинарникам PostgreSQL не должен содержать не-ASCII символы (initdb падает) — `asciiPgHome` копирует их в `%ProgramData%`.
