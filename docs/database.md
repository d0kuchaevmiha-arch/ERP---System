# Модель данных

```mermaid
erDiagram
 organizations ||--o{ users : employs
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

Все PK — UUID, создаются в БД; внешние ключи указаны в `src/db/schema.ts`. Ключевые таблицы: organizations, users, project_access, projects, counterparties, contracts, tasks, task_dependencies, budget_lines, expenses, materials, warehouses, stock_movements, purchases, approvals, documents, notifications, audit_logs.

`users.email` уникален глобально; `(projects.organization_id,code)`, `(materials.organization_id,sku)` и `(project_access.user_id,project_id)` уникальны. Индексы: проекты по организации; задачи, бюджет, расходы и закупки по проекту; движения по паре материал/склад; аудит по организации/времени. FK требуют существования связанных сущностей. NOT NULL применяется к обязательным полям; nullable — ссылки на необязательные договор, работу, проект и др. `status`, `type` и `role` хранятся строками и валидируются API; для строгой защиты при прямом SQL следует добавить CHECK-ограничения в следующей миграции.

`stock_movements.quantity` всегда положителен, знак определяется видом операции. `purchases.received_quantity` показывает принятый объем. `budget_lines.amount` и `expenses.amount` не float. `tasks.parent_id` — иерархия WBS, а `task_dependencies` — связи задач (хранение реализовано, расчет графа нет).
