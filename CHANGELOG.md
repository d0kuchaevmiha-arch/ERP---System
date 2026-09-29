# Changelog

## 0.2.0 — P1: безопасный многопользовательский сервер

**Внимание при обновлении:** сделайте дамп БД (`docs/backup.md`); после обновления все пользователи входят заново (новый формат сессии); `SESSION_SECRET` обязателен (≥ 32 символов).

- Версионные миграции Drizzle (`drizzle/`, `npm run db:migrate`); `drizzle-kit push` больше не используется. Существующая БД, созданная через `push`, сверяется со схемой и помечается baseline без изменения данных.
- Без входа данные не отдаются (страницы → `/login`, API → 401). Флаг `ERP_PRIVATE_MODE` удалён.
- Чтение только в пределах организации и доступных объектов (`project_access`); уведомления — свои; аудит — по роли.
- Вся запись — через доменные команды `src/server/domain/commands`: роль + `project_access` проверяются всегда, в том числе для прогресса, согласования, приёмки и движений; ссылки на чужие сущности отклоняются.
- Гонки: согласование — условный UPDATE (второе решение — 409 «уже решена ‹кем›»), приёмка — `FOR UPDATE` и суммы в NUMERIC, прогресс — блокировка строки; `actualQuantity = 0` сохраняется.
- Сессии: `session_version` (мгновенный отзыв), блокировка пользователя, секрет без фолбэков. Лимит входа — в БД (`login_attempts`), IP — только от доверенного прокси (`TRUSTED_PROXY=1`).
- Управление пользователями (director/super_admin): создание с временным паролем, роли, блокировка, сброс пароля, доступ к объектам; обязательная смена временного пароля.
- Тесты: Vitest + PostgreSQL 16 (`npm run test:db:up && npm test`) — миграции, сессии, вход, изоляция чтения и записи, гонки, пользователи.

## 0.1.0 — MVP foundation

- PostgreSQL schema, Drizzle persistence and demo seed with three construction projects.
- Director overview, project card, WBS, budget/actual, expenses, procurement approval and partial receipt, stock ledger and issue, CSV exports.
- Signed sessions, password hashing, basic project write ACL, audit trail and Docker Compose.
- See README for known limitations and production blockers.
