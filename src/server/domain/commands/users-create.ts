import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import { hashPassword } from '@/server/auth/password';
import { defineCommand } from '../command';
import { audit } from '../context';
import { USER_ADMIN_ROLES } from '../authz';
import { conflict } from '../errors';
import { assertCanAssignRole, publicUser, role, temporaryPassword } from '../users';

// Новый пользователь получает временный пароль (показывается один раз) и обязан сменить его при входе.
export default defineCommand({
  name: 'users.create', offline: 'online_only', roles: USER_ADMIN_ROLES, deniedMessage: 'Управлять пользователями может директор или администратор',
  schema: z.object({ name: z.string().trim().min(2), email: z.string().trim().toLowerCase().pipe(z.email()), role }),
  async authorize(tx, ctx, input) {
    assertCanAssignRole(ctx.actor, input.role);
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (taken) throw conflict('Пользователь с таким email уже есть');
  },
  async execute(tx, ctx, input) {
    const password = temporaryPassword();
    const [row] = await tx.insert(users).values({ organizationId: ctx.actor.organizationId, name: input.name, email: input.email, role: input.role, passwordHash: hashPassword(password), mustChangePassword: true }).returning();
    await audit(tx, ctx, 'create', 'user', row.id, null, publicUser(row));
    return { user: publicUser(row), temporaryPassword: password };
  },
});
