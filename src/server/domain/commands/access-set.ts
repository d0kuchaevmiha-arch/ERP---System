import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { projectAccess, projects } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { USER_ADMIN_ROLES } from '../authz';
import { notFound } from '../errors';
import { manageableUser } from '../users';
import { uuid } from '../schemas';

// Выдать или изменить доступ пользователя к объекту: view — только просмотр, edit — ввод данных.
export default defineCommand({
  name: 'access.set', offline: 'online_only', roles: USER_ADMIN_ROLES, deniedMessage: 'Управлять доступами может директор или администратор',
  schema: z.object({ userId: uuid, projectId: uuid, permission: z.enum(['view', 'edit']) }),
  async authorize(tx, ctx, input) {
    await manageableUser(tx, ctx.actor, input.userId);
    const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.organizationId, ctx.actor.organizationId)));
    if (!p) throw notFound('Объект не найден');
  },
  async execute(tx, ctx, input) {
    const [before] = await tx.select().from(projectAccess).where(and(eq(projectAccess.userId, input.userId), eq(projectAccess.projectId, input.projectId)));
    const [row] = await tx.insert(projectAccess).values(input)
      .onConflictDoUpdate({ target: [projectAccess.userId, projectAccess.projectId], set: { permission: input.permission } }).returning();
    await audit(tx, ctx, 'grant', 'project_access', row.id, before ?? null, row);
    return row;
  },
});
