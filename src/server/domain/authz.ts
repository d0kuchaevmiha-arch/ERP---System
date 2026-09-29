import { and, eq } from 'drizzle-orm';
import { contracts, counterparties, materials, projectAccess, projects, purchases, tasks, warehouses } from '@/db/schema';
import type { Tx } from '@/server/db/types';
import type { Actor } from './context';
import { forbidden, invalid, notFound } from './errors';

export const WRITE_ROLES = ['super_admin', 'director', 'project_manager', 'construction_manager', 'foreman', 'procurement_manager', 'warehouse_manager', 'finance_manager', 'accountant'] as const;
export const DECIDE_ROLES = ['director', 'super_admin', 'project_manager', 'procurement_manager'] as const;
export const ALL_ROLES = [...WRITE_ROLES, 'read_only'] as const;
// Управление пользователями и доступами (Допущение, §14): администратор и директор своей организации.
export const USER_ADMIN_ROLES = ['super_admin', 'director'] as const;
// Роли, которым доступны все объекты своей организации без project_access.
export const ORG_WIDE_ROLES = ['director', 'super_admin'] as const;
export const isOrgWide = (actor: Actor) => (ORG_WIDE_ROLES as readonly string[]).includes(actor.role);

// Объект своей организации, на который у пользователя есть право записи (роль + project_access).
export async function requireProjectWrite(tx: Tx, actor: Actor, projectId: string) {
  const [p] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, actor.organizationId)));
  if (!p) throw notFound('Объект не найден или нет доступа');
  if (!isOrgWide(actor)) {
    const [access] = await tx.select().from(projectAccess).where(and(eq(projectAccess.projectId, p.id), eq(projectAccess.userId, actor.id)));
    if (!access || access.permission !== 'edit') throw forbidden('Недостаточно прав на этот объект');
  }
  return p;
}

// Поиск сущностей строго в пределах организации пользователя: чужая сущность = «не найдено».
export async function orgTask(tx: Tx, actor: Actor, id: string, lock = false) {
  const q = tx.select({ task: tasks }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(eq(tasks.id, id), eq(projects.organizationId, actor.organizationId)));
  const [row] = lock ? await q.for('update', { of: tasks }) : await q;
  if (!row) throw notFound('Работа не найдена');
  return row.task;
}
export async function orgMaterial(tx: Tx, actor: Actor, id: string) {
  const [row] = await tx.select().from(materials).where(and(eq(materials.id, id), eq(materials.organizationId, actor.organizationId)));
  if (!row) throw notFound('Материал не найден');
  return row;
}
export async function orgWarehouse(tx: Tx, actor: Actor, id: string) {
  const [row] = await tx.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.organizationId, actor.organizationId)));
  if (!row) throw notFound('Склад не найден');
  return row;
}
export async function orgCounterparty(tx: Tx, actor: Actor, id: string) {
  const [row] = await tx.select().from(counterparties).where(and(eq(counterparties.id, id), eq(counterparties.organizationId, actor.organizationId)));
  if (!row) throw notFound('Контрагент не найден');
  return row;
}
export async function orgContract(tx: Tx, actor: Actor, id: string) {
  const [row] = await tx.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.organizationId, actor.organizationId)));
  if (!row) throw notFound('Договор не найден');
  return row;
}
export async function orgPurchase(tx: Tx, actor: Actor, id: string, lock = false) {
  const q = tx.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.organizationId, actor.organizationId)));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw notFound('Заявка не найдена');
  return row;
}

// Ссылка на работу/склад/договор другого объекта той же организации — ошибка ввода.
export async function requireTaskOfProject(tx: Tx, actor: Actor, taskId: string | undefined, projectId: string | null) {
  if (!taskId) return null;
  const task = await orgTask(tx, actor, taskId);
  if (task.projectId !== projectId) throw invalid('Работа относится к другому объекту');
  return task;
}
export function requireSameProject(entityProjectId: string | null, projectId: string, what: string) {
  if (entityProjectId && entityProjectId !== projectId) throw invalid(`${what} относится к другому объекту`);
}
