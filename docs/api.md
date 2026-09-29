# HTTP API v1

Все вызовы требуют входа (cookie `erp_session`, HTTP-only, SameSite=Lax). Без входа любой GET/POST возвращает **401**, данные не отдаются никогда. Пока у пользователя временный пароль, всё, кроме `/api/auth*`, отвечает **403** «Смените пароль, чтобы продолжить».

Изменяющие вызовы — JSON; запрос с чужим `Origin` отклоняется (403). Успех: `{data: ...}` и HTTP 201. Ошибки: `{error:{message}}`:

| Код | Когда |
|---|---|
| 400 | нарушено бизнес-правило (нет остатка, приёмка сверх заказа, заказ не согласован) |
| 401 | нет входа или сессия отозвана (блокировка, сброс/смена пароля) |
| 403 | роль или доступ к объекту не позволяют операцию; `view`-доступ не даёт записи |
| 404 | ресурс не найден; сущность другой организации неотличима от несуществующей |
| 409 | конфликт: заявка уже решена другим пользователем; устаревшая `version`; дубликат (email и т. п.) |
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

## Повтор запроса: `Idempotency-Key`

Любой изменяющий запрос (POST/PATCH/PUT/DELETE выше) принимает необязательный заголовок `Idempotency-Key: <UUID>`. Повтор с тем же ключом **не выполняет команду второй раз** и возвращает сохранённый ответ (тот же `data` и код 201; для отклонённой операции — та же ошибка с тем же кодом, даже если условия с тех пор изменились). Тот же ключ с другой командой, другими данными или от другого пользователя → 422. Интерфейс отправляет новый ключ на каждое действие. Ключи хранятся в `sync_ops` и понадобятся для офлайн-синхронизации (P4).

## Версии записей и 409

Строки заявок, согласований, работ, объектов, справочников, договоров и бюджета имеют `version` и `updatedAt` (есть в ответах и в сводке). `approvals.decide` и `purchases.receive` принимают необязательное поле `version` (версия заявки, которую видел пользователь): если заявку уже изменили → **409** «Запись изменил другой пользователь — обновите данные и повторите». Без `version` — прежнее поведение (гонки всё равно исключены блокировками).

## Прогресс работ

`POST /api/v1/progress` пишет факт в историю `task_progress_log` и возвращает работу с полями `applied` и `factId`. `applied: false` — факт старше текущего по времени ввода на устройстве (офлайн-запись пришла позже): он сохранён в истории, текущий прогресс не изменён.

## Номер заявки

`POST /api/v1/purchases` — номер присваивает сервер: `ЗК-<год>-<NNNNN>`, сквозной в организации. Необязательное поле `localRef` (до 64 символов) — временный номер клиента (офлайн, P4), сохраняется как есть.

## Реальное время: `GET /api/sync/events` (SSE)

Требует вход (cookie; токен устройства — P3). Поток `text/event-stream`:

```
retry: 3000
event: ready
data: {"maxSeq":1234}

event: changes
data: {"maxSeq":1240}

: ping
```

- `changes` приходит только по объектам пользователя и изменениям уровня организации (справочники, пользователи, доступы); данных в сигнале нет — клиент перечитывает то, что ему нужно (браузер — сводку через 1,5 с, десктоп в P3 — pull). `maxSeq: -1` — сигнал после восстановления связи сервера с БД: «могло измениться что угодно».
- Heartbeat `: ping` раз в 25 с; на нём же перепроверяется сессия: блокировка, сброс/смена пароля — поток закрывается.
- Ответ содержит `X-Accel-Buffering: no`; прокси не должен буферизовать поток (P5).

Формальный OpenAPI пока не генерируется — таблицы выше являются документацией контракта.
