import { asc, eq, inArray } from 'drizzle-orm';
import { projectAccess, users } from '@/db/schema';
import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';
import { USER_ADMIN_ROLES } from '@/server/domain/authz';
import { forbidden } from '@/server/domain/errors';
import { publicUser } from '@/server/domain/users';

// Пользователи своей организации с доступами к объектам — для экрана «Пользователи».
export async function listUsers(db: Db, actor: SessionUser) {
  if (!(USER_ADMIN_ROLES as readonly string[]).includes(actor.role)) throw forbidden('Управлять пользователями может директор или администратор');
  const rows = await db.select().from(users).where(eq(users.organizationId, actor.organizationId)).orderBy(asc(users.name));
  const access = rows.length ? await db.select().from(projectAccess).where(inArray(projectAccess.userId, rows.map(r => r.id))) : [];
  return rows.map(u => ({ ...publicUser(u), access: access.filter(a => a.userId === u.id).map(a => ({ projectId: a.projectId, permission: a.permission })) }));
}
export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];
