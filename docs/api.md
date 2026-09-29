# HTTP API v1

Все изменяющие вызовы — JSON POST с cookie `erp_session`; возвращают `{data: ...}` и HTTP 201. Ошибки: `{error:{message:"..."}}` с 400/401/403/422. Списки GET возвращают `{data,total,page,limit}`, параметры `page`, `limit` (макс. 100), `search`, `projectId`. GET `/api/v1/overview` — агрегированная сводка (закрывается флагом ERP_PRIVATE_MODE). GET `/api/health` — PostgreSQL readiness. POST/GET/DELETE `/api/auth` — вход, текущая сессия, выход.

| Ресурс | POST: основные поля | Назначение |
|---|---|---|
| `/api/v1/projects` | name, code, address, contractValue, forecast, endDate | Создать объект |
| `/api/v1/tasks` | projectId, name, kind, parentId, startDate, endDate | WBS |
| `/api/v1/progress` | taskId, progress, actualQuantity | Факт работы |
| `/api/v1/budgets` | projectId, category, amount, period | Бюджет |
| `/api/v1/expenses` | projectId, category, description, amount | Расход |
| `/api/v1/materials` | sku, name, unit, minStock, price | Номенклатура |
| `/api/v1/warehouses` | name, projectId, location | Склад |
| `/api/v1/suppliers` | name, kind, inn, contact | Контрагент |
| `/api/v1/contracts` | number, projectId, counterpartyId, kind, amount | Договор |
| `/api/v1/purchases` | projectId, materialId, warehouseId, quantity, unitPrice | Заявка |
| `/api/v1/approvals` | purchaseId, decision (`approve`/`reject`/`return`) | Решение по заявке |
| `/api/v1/receive` | purchaseId, warehouseId, quantity | Частичная/полная приемка |
| `/api/v1/movements` | materialId, warehouseId, type, quantity, taskId | Приход/выдача/списание/возврат |

`GET` доступен для реестровых ресурсов; команды receive/progress не имеют GET. Формальный OpenAPI/Swagger пока не генерируется — таблица является документацией текущего контракта. Не используйте эти эндпоинты для многотенантной эксплуатации до завершения изоляции селекторов.
