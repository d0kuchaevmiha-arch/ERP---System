# Модель данных

```mermaid
erDiagram
 organizations ||--o{ users : employs
 login_attempts
 tasks ||--o{ task_progress_log : history
 organizations ||--o{ change_log : changes
 users ||--o{ sync_ops : operations
 organizations ||--o{ org_counters : numbers
 organizations ||--o{ projects : owns
 organizations ||--o{ counterparties : registers
 users ||--o{ project_access : assigned
 projects ||--o{ project_access : scoped
 projects ||--o{ tasks : contains
 tasks ||--o{ task_dependencies : depends
 projects ||--o{ budget_lines : plans
 projects ||--o{ expenses : incurs
 projects ||--o{ contracts : governs
 counterparties ||--o{ contracts : signs
 projects ||--o{ purchases : requires
 materials ||--o{ purchases : requested
 purchases ||--o{ stock_movements : received
 warehouses ||--o{ stock_movements : holds
 materials ||--o{ stock_movements : moves
 organizations ||--o{ audit_logs : records
 organizations ||--o{ approvals : routes
 projects ||--o{ documents : attaches
```

## Миграции

Схема меняется только версионными миграциями Drizzle в `drizzle/` (`npm run db:generate` после правки `src/db/schema.ts`, ревью SQL, коммит). Применение — `npm run db:migrate` (или автоматически при старте контейнера: `scripts/migrate.ts`). `drizzle-kit push` не используется.

- Журнал применённых миграций — `drizzle.__drizzle_migrations`. Параллельный запуск нескольких экземпляров безопасен (advisory lock).
- **Baseline.** БД, созданная раньше через `push` (есть `public.organizations`, нет журнала), сначала сверяется со схемой `0000_baseline`: все таблицы и колонки должны существовать. Тогда `0000` помечается применённой без изменения данных, затем применяются остальные. При расхождении — остановка с перечнем недостающего; данные не трогаются, нужна ручная сверка.

| Миграция | Содержание |
|---|---|
| `0000_baseline` | Схема 0.1.0 без изменений |
| `0001_users_security` | `users.is_active`, `session_version`, `must_change_password`, `password_changed_at`; таблица `login_attempts (key PK, count, until)` |
| `0002_provenance_versions_changelog` | Происхождение фактов; `version`/`updated_at`; `task_progress_log`, `change_log`, `sync_ops`, `org_counters`; `tasks.progress_reported_at`, `purchases.local_ref`. Бэкфилл: `server_received_at = created_at`, `updated_at = created_at`, у старых фактов `origin='online'`, `device_created_at` = NULL (неизвестно) |

### Происхождение и версии (0.3.0)
- **Факты** (`expenses`, `stock_movements`, `purchases`, `task_progress_log`): `origin` ('online' | 'offline'), `device_id`, `device_created_at` (время ввода на устройстве), `server_received_at` (время приёма сервером), `op_id` (ключ операции). То же происхождение — в `audit_logs` (`origin`, `device_id`, `device_created_at`).
- **`version` + `updated_at`** на projects, tasks, purchases, approvals, materials, warehouses, counterparties, contracts, budget_lines: каждое изменение строки увеличивает `version`.
- **`task_progress_log`** — история фактов выполнения (кто, когда, сколько, `applied`); `tasks.progress` = факт с наибольшим `device_created_at`, его время — в `tasks.progress_reported_at`.
- **`change_log`** (`seq` bigserial, `organization_id`, `project_id` — NULL для изменений уровня организации, `entity` = имя таблицы, `entity_id`, `op` 'upsert'|'delete', `changed_at`) — пишется в той же транзакции, что и данные; хранение 90 дней (очистка хабом изменений). Индексы: (organization_id, seq), changed_at.
- **`sync_ops`** — результат операции по ключу (`op_id` PK, пользователь, команда, хеш данных, `status` 'applied'|'rejected', HTTP-код, результат). Хранится бессрочно (очистка — P5).
- **`org_counters`** (organization_id, name) → value — сквозные номера (заявки `ЗК-<год>-<NNNNN>`).

Все PK — UUID, создаются в БД; внешние ключи указаны в `src/db/schema.ts`. Ключевые таблицы: organizations, users, project_access, projects, counterparties, contracts, tasks, task_dependencies, budget_lines, expenses, materials, warehouses, stock_movements, purchases, approvals, documents, notifications, audit_logs.

`users.email` уникален глобально; `(projects.organization_id,code)`, `(materials.organization_id,sku)` и `(project_access.user_id,project_id)` уникальны. Индексы: проекты по организации; задачи, бюджет, расходы и закупки по проекту; движения по паре материал/склад; аудит по организации/времени. FK требуют существования связанных сущностей. NOT NULL применяется к обязательным полям; nullable — ссылки на необязательные договор, работу, проект и др. `status`, `type` и `role` хранятся строками и валидируются API; для строгой защиты при прямом SQL следует добавить CHECK-ограничения в следующей миграции.

`stock_movements.quantity` всегда положителен, знак определяется видом операции. `purchases.received_quantity` показывает принятый объем. `budget_lines.amount` и `expenses.amount` не float. `tasks.parent_id` — иерархия WBS, а `task_dependencies` — связи задач (хранение реализовано, расчет графа нет).
