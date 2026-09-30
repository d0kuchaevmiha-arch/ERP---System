# HTTP API v1

Все вызовы требуют входа (cookie `erp_session`, HTTP-only, SameSite=Lax). Без входа любой GET/POST возвращает **401**, данные не отдаются никогда. Пока у пользователя временный пароль, всё, кроме `/api/auth*`, отвечает **403** «Смените пароль, чтобы продолжить».

Изменяющие вызовы — JSON; запрос с чужим `Origin` отклоняется (403): хост из `Origin` сравнивается с `Host` (за прокси — `X-Forwarded-Host`), поэтому прокси должен передавать исходный хост. Успех: `{data: ...}` и HTTP 201. Ошибки: `{error:{message}}`:

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

## Десктоп-клиент: устройство и синхронизация (0.4.0)

Протокол синхронизации v1 (§6 спецификации). Все запросы десктопа: `Authorization: Bearer <токен устройства>` и `X-Sync-Protocol: 1`; другая или отсутствующая версия → **426** (обновите приложение). Отозванное устройство или заблокированный пользователь → **401**. Токен устройства принимают также все `/api/v1/*`, `/api/admin/*` и `/api/sync/events`; ответы изменяющих команд содержат заголовок **`X-Change-Seq`** — номер журнала изменений после commit (клиент ждёт, пока реплика его догонит).

| Метод и путь | Назначение |
|---|---|
| POST `/api/auth/device` {email, password, deviceName, appVersion} | Регистрация устройства → `{deviceId, token, user}` (201). Токен выдаётся один раз, на сервере хранится только SHA-256. Тот же лимит попыток, что у входа; временный пароль → 403 «смените пароль в браузере» |
| GET `/api/sync/scope` | Объекты для «Доступно офлайн»: `{available:[{id,code,name}], defaultScope, orgWide, user, deviceId}`. По умолчанию — все доступные; у director/super_admin — пусто |
| GET `/api/sync/snapshot?entity=&projects=&cursor=&limit=` | Первичная загрузка сущности страницами по id → `{rows, nextCursor, snapshotSeq, scope}`. `snapshotSeq` берётся до чтения строк — дальше pull с него |
| GET `/api/sync/pull?since=&limit=&projects=` | Изменения после `since` → `{changes:[{seq, entity, id, op, row}], nextSeq, hasMore, scope}`. Текущая версия строки (дедуп по id); `op:'delete'` — удалённые строки; объекты, выпавшие из `scope` (отзыв доступа, снят с офлайн-набора), клиент удаляет сам. **410** — журнал изменений очищен дальше, чем отстал клиент: нужен повторный snapshot |
| POST `/api/admin/devices/:id/revoke` | Отозвать устройство (владелец — своё; director/super_admin — любое в организации) |

`projects` — список id через запятую: параметр не передан — набор по умолчанию; пустое значение — ни одного объекта; чужие/недоступные id игнорируются.

**Что реплицируется** (`src/server/sync/entities.ts`): своя организация; пользователи организации (имя, роль, активность; email — только свой; без хешей паролей); свои `project_access` и уведомления; справочники (materials, counterparties, warehouses); объекты офлайн-набора и их работы, связи работ, бюджеты, расходы, заявки, согласования, договоры, история прогресса; движения всех складов организации (для верных остатков; у движений вне офлайн-набора скрыты объект, работа, заявка и примечание). Никогда: `audit_logs`, `devices`, `sync_ops`, `login_attempts`.

Локальный интерфейс десктопа (`ERP_MODE=client`) дополнительно имеет POST `/api/client/scope` {projects: string[] | null} — сохранить «Доступно офлайн» (только из окна приложения).

## Офлайн-ввод: очередь, конфликты, вход устройства (0.5.0)

Десктоп сохраняет офлайн-операции в локальную очередь и отправляет их пакетом. Сервер прогоняет каждую операцию через те же доменные команды, что и `POST /api/v1/*`.

| Метод и путь | Назначение |
|---|---|
| POST `/api/sync/push` {ops:[{opId, command, payload, deviceCreatedAt, dependsOn?}]} | Не больше 200 операций. Порядок сохраняется, каждая операция — в своей транзакции. Ответ: `{results:[{opId, status, entityId?, error?:{code,message}, conflictId?}]}`. Повтор `opId` возвращает сохранённый ответ; устройство берётся из токена. Неверный формат пакета → 422 для всего пакета |
| POST `/api/auth/device/verify` {password} | Вход в десктоп при запуске: пароль пользователя устройства, тот же лимит попыток, что у входа → `{user, serverTime}`. Отказы: 401 `bad_password`, 401 `device_revoked` (устройство отозвано или пользователь заблокирован), 403 `must_change_password`, 429 |
| POST `/api/v1/conflict-resolve` {conflictId, quantity, warehouseId?} | «Провести с исправлением»: исходная команда выполняется с новым количеством, а для выдачи/списания можно указать другой склад. Проверки те же, что и при обычном вводе. Сохраняются id строки и происхождение с ноутбука. Повторный разбор → 409 «Уже решено: … — ‹кто›» |
| POST `/api/v1/conflict-discard` {conflictId, comment} | «Отклонить» с обязательной причиной; автор увидит её в «Не принято сервером» |

**Статусы операций в ответе push:**
- `applied` — операция проведена; `entityId` — id строки, созданной на ноутбуке. Сервер сохраняет строку с этим же id.
- `conflict` — только для `movements.create` (код `insufficient_stock`) и `purchases.receive` (код `over_receipt`). Операция попадает в `sync_conflicts` и видна в «Требует решения».
- `rejected` — операция отклонена. Коды:
  - `no_access` — нет прав на объект;
  - `not_found` — сущность не найдена на сервере;
  - `validation`, `business_rule` — ошибка в данных или нарушено бизнес-правило;
  - `online_only` — команда выполняется только онлайн;
  - `dependency_rejected` — отклонена операция, от которой зависит эта;
  - `user_blocked` — операция введена в интервале блокировки пользователя;
  - `duplicate_id` — строка с таким id уже есть;
  - `conflict_discarded` — отклонена при разборе конфликта (вместе с причиной).

**Офлайн-команды** (`offline` ≠ `online_only`):
- `progress.set`, `expenses.create`, `purchases.create` (номер `ЗК-…` присваивает сервер, временный номер ноутбука хранится в `localRef`);
- `movements.create` — приход, возврат, выдача, списание;
- `purchases.receive` — офлайн без `version`.

Во всех этих командах есть необязательное поле `id` (UUID создаваемой строки).

`sync_conflicts` реплицируется на ноутбук, если пользователь — автор операции или может разобрать конфликт (роль и доступ к объекту). Так автор узнаёт итог разбора.

Локальный интерфейс десктопа (`ERP_MODE=client`):
- `POST /api/v1/<офлайн-ресурс>` пишет в очередь → 201 `{data, sync: 'applied' | 'conflict' | 'queued', warning?}`. При связи ответ сервера ждётся до 5 с; отклонение сервером → 422 с причиной.
- Остальные запросы пересылаются на сервер; без связи → 503 «Нужна связь с сервером».
- GET `/api/client/outbox/export` — экспорт очереди в JSON (без токена и секретов).
- POST `/api/client/outbox/hide` {opId} — скрыть отклонённую операцию с экрана.

Формальный OpenAPI пока не генерируется — таблицы выше являются документацией контракта.
