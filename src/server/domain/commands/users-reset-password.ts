import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import { hashPassword } from '@/server/auth/password';
import { defineCommand } from '../command';
import { audit, changed } from '../context';
import { USER_ADMIN_ROLES } from '../authz';
import { forbidden } from '../errors';
import { manageableUser, publicUser, temporaryPassword } from '../users';
import { uuid } from '../schemas';

// Сброс: новый временный пароль, обязательная смена при входе, все текущие сессии отозваны.
export default defineCommand({
  name: 'users.resetPassword', offline: 'online_only', roles: USER_ADMIN_ROLES, deniedMessage: 'Управлять пользователями может директор или администратор',
  schema: z.object({ userId: uuid }),
  async authorize(tx, ctx, input) {
    const target = await manageableUser(tx, ctx.actor, input.userId);
    if (target.id === ctx.actor.id) throw forbidden('Свой пароль меняйте через «Сменить пароль»');
    return target;
  },
  async execute(tx, ctx, _input, target) {
    const password = temporaryPassword();
    const [row] = await tx.update(users).set({ passwordHash: hashPassword(password), mustChangePassword: true, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, target.id)).returning();
    await audit(tx, ctx, 'reset_password', 'user', row.id, null, { mustChangePassword: true });
    changed(ctx, 'users', row.id, null);
    return { user: publicUser(row), temporaryPassword: password };
  },
});
