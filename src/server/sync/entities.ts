import { and, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  approvals, budgetLines, contracts, counterparties, expenses, materials, notifications, organizations, projectAccess,
  projects, purchases, stockMovements, syncConflicts, taskDependencies, taskProgressLog, tasks, users, warehouses,
} from '@/db/schema';
import type { SessionUser } from '@/server/auth/session';
import { conflictVisibility } from '@/server/read/conflicts';

// Что реплицируется на ноутбук (§6.3, §10, решение P3 №7) и кому. Сервер — источник истины: клиент получает
// только строки, которые пользователь и так видит онлайн, и только объекты из его офлайн-набора.
// Никогда не реплицируются: хеши паролей, audit_logs, sync_ops, devices, login_attempts.

export type SyncScope = { user: SessionUser; projectIds: string[] };

// Договоры без объекта видны тем же ролям, что и онлайн (P1-допущение).
const ORG_CONTRACT_ROLES = ['director', 'super_admin', 'finance_manager', 'accountant'];
const NONE = '00000000-0000-0000-0000-000000000000';
const inScope = (col: Parameters<typeof inArray>[0], s: SyncScope): SQL => (s.projectIds.length ? inArray(col, s.projectIds) : eq(col, NONE));

type Entity = {
  table: PgTable & { id: Parameters<typeof eq>[0] };
  visible: (s: SyncScope) => SQL | undefined;
  // Колонки ответа; по умолчанию — все.
  columns?: Record<string, unknown> | ((s: SyncScope) => Record<string, unknown>);
};

// Порядок — от справочников к фактам (удобно для первичной загрузки; внешние ключи в реплике не проверяются).
export const SYNC_ENTITIES: Record<string, Entity> = {
  organizations: { table: organizations, visible: s => eq(organizations.id, s.user.organizationId) },
  users: {
    table: users, visible: s => eq(users.organizationId, s.user.organizationId),
    // Как онлайн: имя и роль коллег; email — только свой; хеши и версии сессий — никогда.
    columns: s => ({ id: users.id, organizationId: users.organizationId, name: users.name, email: sql<string | null>`case when ${users.id} = ${s.user.id} then ${users.email} else null end`.as('email'), role: users.role, isActive: users.isActive, createdAt: users.createdAt }),
  },
  projects: { table: projects, visible: s => and(eq(projects.organizationId, s.user.organizationId), inScope(projects.id, s)) },
  project_access: { table: projectAccess, visible: s => eq(projectAccess.userId, s.user.id) },
  counterparties: { table: counterparties, visible: s => eq(counterparties.organizationId, s.user.organizationId) },
  materials: { table: materials, visible: s => eq(materials.organizationId, s.user.organizationId) },
  warehouses: { table: warehouses, visible: s => eq(warehouses.organizationId, s.user.organizationId) },
  contracts: {
    table: contracts,
    visible: s => and(eq(contracts.organizationId, s.user.organizationId), ORG_CONTRACT_ROLES.includes(s.user.role) ? or(isNull(contracts.projectId), inScope(contracts.projectId, s)) : inScope(contracts.projectId, s)),
  },
  tasks: { table: tasks, visible: s => inScope(tasks.projectId, s) },
  task_dependencies: { table: taskDependencies, visible: s => inArray(taskDependencies.taskId, sql`(select ${tasks.id} from ${tasks} where ${inScope(tasks.projectId, s)})`) },
  budget_lines: { table: budgetLines, visible: s => inScope(budgetLines.projectId, s) },
  purchases: { table: purchases, visible: s => and(eq(purchases.organizationId, s.user.organizationId), inScope(purchases.projectId, s)) },
  approvals: {
    table: approvals,
    visible: s => and(eq(approvals.organizationId, s.user.organizationId), eq(approvals.entityType, 'purchase'),
      inArray(approvals.entityId, sql`(select ${purchases.id} from ${purchases} where ${inScope(purchases.projectId, s)})`)),
  },
  expenses: { table: expenses, visible: s => inScope(expenses.projectId, s) },
  // Движения всех складов организации: остатки на ноутбуке совпадают с сервером (решение P3 №7).
  // У движений вне офлайн-набора отдаются только поля, нужные для остатка: объект, работа, заявка и примечание скрыты.
  stock_movements: {
    table: stockMovements,
    visible: s => inArray(stockMovements.warehouseId, sql`(select ${warehouses.id} from ${warehouses} where ${warehouses.organizationId} = ${s.user.organizationId})`),
    columns: s => {
      const open = sql`(${stockMovements.projectId} is null or ${inScope(stockMovements.projectId, s)})`;
      const mask = <T>(col: Parameters<typeof sql>[1], name: string) => sql<T>`case when ${open} then ${col} else null end`.as(name);
      return {
        ...getTableColumns(stockMovements),
        projectId: mask<string | null>(stockMovements.projectId, 'project_id'),
        purchaseId: mask<string | null>(stockMovements.purchaseId, 'purchase_id'),
        taskId: mask<string | null>(stockMovements.taskId, 'task_id'),
        note: mask<string | null>(stockMovements.note, 'note'),
      };
    },
  },
  task_progress_log: { table: taskProgressLog, visible: s => inScope(taskProgressLog.projectId, s) },
  notifications: { table: notifications, visible: s => eq(notifications.userId, s.user.id) },
  // Спорные офлайн-операции (P4): свои — чтобы автор узнал итог разбора; разбираемые — в офлайн-наборе.
  sync_conflicts: { table: syncConflicts, visible: s => conflictVisibility(s.user, s.projectIds) },
};
export const SYNC_ENTITY_NAMES = Object.keys(SYNC_ENTITIES);
