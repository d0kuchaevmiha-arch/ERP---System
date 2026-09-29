import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import { defineCommand } from '../command';
import { audit, changed } from '../context';
import { USER_ADMIN_ROLES } from '../authz';
import { forbidden } from '../errors';
import { assertCanAssignRole, manageableUser, publicUser, role } from '../users';
import { uuid } from '../schemas';
import { revokeUserDevices } from '../devices';

// Имя, роль, блокировка. Блокировка сразу отзывает все сессии (session_version + 1).
// Себя нельзя заблокировать или сменить себе роль — так в организации всегда остаётся тот, кто управляет доступом.
export default defineCommand({
  name: 'users.update', offline: 'online_only', roles: USER_ADMIN_ROLES, deniedMessage: 'Управлять пользователями может директор или администратор',
  schema: z.object({ userId: uuid, name: z.string().trim().min(2).optional(), role: role.optional(), isActive: z.boolean().optional() }),
  async authorize(tx, ctx, input) {
    const target = await manageableUser(tx, ctx.actor, input.userId);
    if (target.id === ctx.actor.id && ((input.role && input.role !== target.role) || input.isActive === false)) throw forbidden('Нельзя заблокировать себя или изменить свою роль');
    if (input.role) assertCanAssignRole(ctx.actor, input.role);
    return target;
  },
  async execute(tx, ctx, input, before) {
    const blocking = input.isActive === false && before.isActive;
    const [row] = await tx.update(users).set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(blocking && { sessionVersion: sql`${users.sessionVersion} + 1` }),
    }).where(eq(users.id, before.id)).returning();
    if (blocking) await revokeUserDevices(tx, row.id);
    await audit(tx, ctx, blocking ? 'block' : input.isActive === true && !before.isActive ? 'unblock' : 'update', 'user', row.id, publicUser(before), publicUser(row));
    changed(ctx, 'users', row.id, null);
    return publicUser(row);
  },
});
