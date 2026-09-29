# Разработка и проверки

`npm ci`; задать DATABASE_URL и SESSION_SECRET (≥ 32 символов) в `.env`; `npm run db:migrate` (версионные миграции; `drizzle-kit push` не использовать, изменения схемы — правка `src/db/schema.ts` → `npm run db:generate` → ревью SQL в `drizzle/`); `npx tsx --env-file=.env scripts/seed.ts`; `npm run dev`.

## Проверки (после каждого изменения)
- `npm run typecheck`, `npm run lint`, `npm run build`;
- `npm run test:db:up` (один раз; PostgreSQL 16 в памяти на 127.0.0.1:54329, профиль `test`), затем `npm test`. Каждый тестовый файл создаёт свою БД и применяет миграции; моков БД нет;
- HTTP smoke против запущенного compose: `npx tsx --env-file=.env scripts/smoke.ts` — аноним → 401; проект → бюджет → работа → заявка → согласование (+ повтор → 409) → приёмка → списание → прогресс → расход → план/факт → аудит → отказ при дефиците → создание пользователя → временный пароль → смена → нет доступа (403) → выдача доступа → блокировка. Тестовые записи остаются в demo-БД.

## Как добавить операцию записи
1. Файл `src/server/domain/commands/<сущность>-<действие>.ts` через `defineCommand`: `name`, `offline` (политика §5.1 спецификации), `roles`, Zod-`schema`, `authorize` (организация + `project_access`: используйте `requireProjectWrite`, `org*`-поиск и `requireTaskOfProject` из `authz.ts`), `execute` (запись + `audit`).
2. Зарегистрировать в `registry.ts` (и в `httpCommands`, если нужен POST `/api/v1/<resource>`).
3. Тест в `test/` на настоящей БД: права, изоляция, бизнес-правило.

Деньги и количества сравнивать и складывать в NUMERIC на стороне БД; `Number` — только для отображения. Известный долг: агрегаты сводки (`src/server/read/overview.ts`) считаются в JS и без пагинации — вынести в SQL при росте данных.
