import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { defineCommand } from '../command';
import { audit, changed } from '../context';
import { ALL_ROLES } from '../authz';
import { invalid } from '../errors';
import { newPassword, publicUser } from '../users';

// Смена своего пароля (в т. ч. обязательная после выдачи временного). Остальные сессии отзываются;
// вызывающий получает новую cookie из route handler по возвращённой строке.
export default defineCommand({
  name: 'auth.changePassword', offline: 'online_only', roles: ALL_ROLES,
  schema: z.object({ currentPassword: z.string().min(1), newPassword }),
  async authorize(tx, ctx, input) {
    const [me] = await tx.select().from(users).where(eq(users.id, ctx.actor.id)).for('update');
    if (!me || !verifyPassword(input.currentPassword, me.passwordHash)) throw invalid('Текущий пароль указан неверно');
    if (input.currentPassword === input.newPassword) throw invalid('Новый пароль должен отличаться от текущего');
    return me;
  },
  async execute(tx, ctx, input, me) {
    const [row] = await tx.update(users).set({ passwordHash: hashPassword(input.newPassword), mustChangePassword: false, passwordChangedAt: new Date(), sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, me.id)).returning();
    await audit(tx, ctx, 'change_password', 'user', row.id, null, { passwordChangedAt: row.passwordChangedAt });
    changed(ctx, 'users', row.id, null);
    // Без хеша пароля; sessionVersion нужен, чтобы выдать новую cookie.
    return { ...publicUser(row), sessionVersion: row.sessionVersion };
  },
});
