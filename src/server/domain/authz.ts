import { and, eq } from 'drizzle-orm';
import { projectAccess, projects } from '@/db/schema';
import type { Tx } from '@/server/db/types';
import type { Actor } from './context';
import { businessRule } from './errors';

export const WRITE_ROLES = ['super_admin', 'director', 'project_manager', 'construction_manager', 'foreman', 'procurement_manager', 'warehouse_manager', 'finance_manager', 'accountant'] as const;
export const DECIDE_ROLES = ['director', 'super_admin', 'project_manager', 'procurement_manager'] as const;
// Роли, которым доступны все объекты своей организации без project_access.
export const ORG_WIDE_ROLES = ['director', 'super_admin'] as const;
export const isOrgWide = (actor: Actor) => (ORG_WIDE_ROLES as readonly string[]).includes(actor.role);

// Объект своей организации, на который у пользователя есть право записи.
export async function requireProjectWrite(tx: Tx, actor: Actor, projectId: string) {
  const [p] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, actor.organizationId)));
  if (!p) throw businessRule('Объект не найден или нет доступа');
  if (!isOrgWide(actor)) {
    const [access] = await tx.select().from(projectAccess).where(and(eq(projectAccess.projectId, p.id), eq(projectAccess.userId, actor.id)));
    if (!access || access.permission === 'view') throw businessRule('Недостаточно прав на этот объект');
  }
  return p;
}
