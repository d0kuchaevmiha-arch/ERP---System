# HTTP API v1

Все вызовы требуют входа (cookie `erp_session`, HTTP-only, SameSite=Lax). Без входа любой GET/POST возвращает **401**, данные не отдаются никогда. Пока у пользователя временный пароль, всё, кроме `/api/auth*`, отвечает **403** «Смените пароль, чтобы продолжить».

Изменяющие вызовы — JSON; запрос с чужим `Origin` отклоняется (403). Успех: `{data: ...}` и HTTP 201. Ошибки: `{error:{message}}`:

| Код | Когда |
|---|---|
| 400 | нарушено бизнес-правило (нет остатка, приёмка сверх заказа, заказ не согласован) |
| 401 | нет входа или сессия отозвана (блокировка, сброс/смена пароля) |
| 403 | роль или доступ к объекту не позволяют операцию; `view`-доступ не даёт записи |
| 404 | ресурс не найден; сущность другой организации неотличима от несуществующей |
| 409 | конфликт: заявка уже решена другим пользователем; дубликат (email и т. п.) |
| 422 | ошибка ввода (Zod), ссылка на работу/склад/договор другого объекта, > 3 знаков в количестве |
| 429 | слишком много неудачных попыток входа |

## Данные

GET `/api/v1/overview` — сводка **только в пределах организации пользователя и доступных ему объектов** (director/super_admin — все объекты организации; остальные — по `project_access`). GET `/api/v1/<resource>` — реестр из той же сводки: `{data,total,page,limit}`, параметры `page`, `limit` (макс. 100), `search`, `projectId`. GET `/api/health` — готовность PostgreSQL.

| Ресурс (POST) | Команда | Основные поля | Кто может |
|---|---|---|---|
| `/api/v1/projects` | `projects.create` | name, code, address, contractValue, forecast, endDate | роли записи |
| `/api/v1/tasks` | `tasks.create` | projectId, name, kind, parentId (того же объекта), startDate, endDate | edit на объект |
| `/api/v1/progress` | `progress.set` | taskId, progress, actualQuantity (0 допустим) | edit на объект работы |
| `/api/v1/budgets` | `budgets.create` | projectId, category, amount, taskId, period | edit на объект |
| `/api/v1/expenses` | `expenses.create` | projectId, category, description, amount, taskId, contractId, counterpartyId | edit на объект |
| `/api/v1/materials` | `materials.create` | sku, name, unit, minStock, price | роли записи |
| `/api/v1/warehouses` | `warehouses.create` | name, projectId, location | роли записи; с projectId — edit на объект |
| `/api/v1/suppliers` | `counterparties.create` | name, kind, inn, contact | роли записи |
| `/api/v1/contracts` | `contracts.create` | number, projectId, counterpartyId, kind, amount | роли записи; с projectId — edit |
| `/api/v1/purchases` | `purchases.create` | projectId, materialId, warehouseId, supplierId, quantity, unitPrice | edit на объект |
| `/api/v1/approvals` | `approvals.decide` | purchaseId, decision (`approve`/`reject`/`return`), comment | director, super_admin, project_manager, procurement_manager + edit на объект заявки |
| `/api/v1/receive` | `purchases.receive` | purchaseId, warehouseId, quantity | те же роли + edit на объект заявки |
| `/api/v1/movements` | `movements.create` | materialId, warehouseId, type, quantity, taskId, projectId | роли записи + edit на объект склада |

Количество — не более 3 знаков после запятой; деньги — строка с не более 2 знаками.

## Вход и пароль

| Метод и путь | Назначение |
|---|---|
| POST `/api/auth` {email, password} | Вход. Ответ `{user:{…, mustChangePassword}}`. 10 неудач по ключу email+IP за 15 минут → 429 (счётчик в БД, общий для всех экземпляров). |
| GET `/api/auth` | Текущий пользователь или `null` |
| DELETE `/api/auth` | Выход |
| POST `/api/auth/password` {currentPassword, newPassword} | Смена своего пароля (≥ 10 символов). Все прочие сессии отзываются, текущему окну выдаётся новая cookie. |

## Пользователи и доступы (director, super_admin)

| Метод и путь | Команда | Назначение |
|---|---|---|
| GET `/api/admin/users` | — | Пользователи своей организации с доступами к объектам (без хешей паролей) |
| POST `/api/admin/users` {name, email, role} | `users.create` | Создать. Ответ содержит `temporaryPassword` — показывается один раз; при входе потребуется смена |
| PATCH `/api/admin/users/:id` {name?, role?, isActive?} | `users.update` | Имя, роль, блокировка (сразу отзывает сессии). Себя заблокировать/сменить себе роль нельзя |
| POST `/api/admin/users/:id/reset-password` | `users.resetPassword` | Новый временный пароль, сессии отозваны |
| PUT `/api/admin/users/:id/access/:projectId` {permission: view\|edit} | `access.set` | Выдать или изменить доступ к объекту |
| DELETE `/api/admin/users/:id/access/:projectId` | `access.remove` | Отозвать доступ |

Назначать и изменять `super_admin` может только `super_admin`.

Формальный OpenAPI пока не генерируется — таблицы выше являются документацией контракта.
