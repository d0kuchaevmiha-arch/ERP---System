import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { projectAccess } from '@/db/schema';
import { defineCommand } from '../command';
import { audit, changed } from '../context';
import { USER_ADMIN_ROLES } from '../authz';
import { notFound } from '../errors';
import { manageableUser } from '../users';
import { uuid } from '../schemas';

export default defineCommand({
  name: 'access.remove', offline: 'online_only', roles: USER_ADMIN_ROLES, deniedMessage: 'Управлять доступами может директор или администратор',
  schema: z.object({ userId: uuid, projectId: uuid }),
  async authorize(tx, ctx, input) { await manageableUser(tx, ctx.actor, input.userId); },
  async execute(tx, ctx, input) {
    const [row] = await tx.delete(projectAccess).where(and(eq(projectAccess.userId, input.userId), eq(projectAccess.projectId, input.projectId))).returning();
    if (!row) throw notFound('Доступ не найден');
    await audit(tx, ctx, 'revoke', 'project_access', row.id, row, null);
    changed(ctx, 'project_access', row.id, null, 'delete');
    return row;
  },
});
