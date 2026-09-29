import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '@/db/schema';
import type { Tx } from '@/server/db/types';
import type { Actor } from './context';
import { ALL_ROLES } from './authz';
import { forbidden, notFound } from './errors';

// Политика пароля (Допущение, §14): не короче 10 символов.
export const PASSWORD_MIN = 10;
export const newPassword = z.string().min(PASSWORD_MIN, `Пароль — не короче ${PASSWORD_MIN} символов`).max(200);
export const role = z.enum(ALL_ROLES);

// Временный пароль из 16 символов без похожих букв/цифр (0/O, 1/l/I) — его диктуют или пересылают.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function temporaryPassword(length = 16) {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

// Пользователь без секретов — для ответов API и журнала аудита.
export function publicUser(u: typeof users.$inferSelect) {
  return { id: u.id, organizationId: u.organizationId, name: u.name, email: u.email, role: u.role, isActive: u.isActive, mustChangePassword: u.mustChangePassword, passwordChangedAt: u.passwordChangedAt, createdAt: u.createdAt };
}

// Пользователь своей организации; администратора (super_admin) может менять только super_admin.
export async function manageableUser(tx: Tx, actor: Actor, userId: string) {
  const [u] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId))).for('update');
  if (!u) throw notFound('Пользователь не найден');
  if (u.role === 'super_admin' && actor.role !== 'super_admin') throw forbidden('Изменять администратора может только администратор');
  return u;
}
export function assertCanAssignRole(actor: Actor, target: string) {
  if (target === 'super_admin' && actor.role !== 'super_admin') throw forbidden('Назначить администратора может только администратор');
}
