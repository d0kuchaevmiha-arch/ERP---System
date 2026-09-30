import { getTableColumns, getTableName, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import * as s from '@/db/schema';
import type { Tx } from '@/server/db/types';

// Применение данных сервера к локальной реплике. Реплика — копия: целостность уже проверил сервер,
// поэтому внешние ключи на время пакета отключены (строки могут прийти не в порядке зависимостей).

type AnyTable = PgTable & { id: PgColumn };
export const REPLICA_TABLES: Record<string, AnyTable> = {
  organizations: s.organizations, users: s.users, projects: s.projects, project_access: s.projectAccess, counterparties: s.counterparties,
  materials: s.materials, warehouses: s.warehouses, contracts: s.contracts, tasks: s.tasks, task_dependencies: s.taskDependencies,
  budget_lines: s.budgetLines, purchases: s.purchases, approvals: s.approvals, expenses: s.expenses, stock_movements: s.stockMovements,
  task_progress_log: s.taskProgressLog, notifications: s.notifications, sync_conflicts: s.syncConflicts,
};

export async function replicaSession(tx: Tx) {
  await tx.execute(sql`set local session_replication_role = replica`);
}

// JSON → значения колонок: даты-время из строк ISO. У users — пустой хеш пароля (на клиенте паролей сервера нет)
// и заглушка вместо скрытого сервером email коллеги (колонка NOT NULL UNIQUE; интерфейс показывает имя и роль).
function toRow(table: AnyTable, raw: Record<string, unknown>) {
  const cols = getTableColumns(table);
  const row: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in raw)) continue;
    const v = raw[key];
    row[key] = v != null && col.columnType === 'PgTimestamp' ? new Date(v as string) : v;
  }
  if (table === s.users) {
    row.passwordHash = '';
    if (!row.email) row.email = `${row.id}@replica.invalid`;
  }
  return row;
}

export async function upsertRows(tx: Tx, entity: string, rows: Record<string, unknown>[]) {
  const table = REPLICA_TABLES[entity];
  if (!table || !rows.length) return;
  const cols = getTableColumns(table);
  const values = rows.map(r => toRow(table, r));
  const keys = Object.keys(values[0]).filter(k => k !== 'id' && !(table === s.users && k === 'passwordHash'));
  const set = Object.fromEntries(keys.map(k => [k, sql.raw(`excluded."${cols[k].name}"`)]));
  for (let i = 0; i < values.length; i += 500)
    await tx.insert(table).values(values.slice(i, i + 500) as never).onConflictDoUpdate({ target: table.id, set: set as never });
}

export async function deleteRows(tx: Tx, entity: string, ids: string[]) {
  const table = REPLICA_TABLES[entity];
  if (table && ids.length) await tx.delete(table).where(inArray(table.id, ids));
}

export async function clearReplica(tx: Tx) {
  for (const table of Object.values(REPLICA_TABLES)) await tx.execute(sql`delete from ${table}`);
}

// Объект выпал из офлайн-набора (убран пользователем или доступ отозван) — его строки удаляются с ноутбука.
export async function purgeOutsideScope(tx: Tx, scope: string[]) {
  const keep = scope.length ? scope : ['00000000-0000-0000-0000-000000000000'];
  const out = (col: Parameters<typeof notInArray>[0]): SQL => notInArray(col, keep);
  await tx.delete(s.taskDependencies).where(inArray(s.taskDependencies.taskId, sql`(select ${s.tasks.id} from ${s.tasks} where ${out(s.tasks.projectId)})`));
  await tx.delete(s.approvals).where(inArray(s.approvals.entityId, sql`(select ${s.purchases.id} from ${s.purchases} where ${out(s.purchases.projectId)})`));
  for (const t of [s.taskProgressLog, s.expenses, s.budgetLines, s.purchases, s.tasks]) await tx.delete(t).where(out(t.projectId));
  await tx.delete(s.contracts).where(sql`${s.contracts.projectId} is not null and ${out(s.contracts.projectId)}`);
  await tx.delete(s.projects).where(out(s.projects.id));
  // Движения складов организации остаются (остатки), но их привязка к выпавшему объекту скрывается.
  await tx.update(s.stockMovements).set({ projectId: null, purchaseId: null, taskId: null, note: null }).where(sql`${s.stockMovements.projectId} is not null and ${out(s.stockMovements.projectId)}`);
}

export const tableNameOf = (entity: string) => getTableName(REPLICA_TABLES[entity]);
