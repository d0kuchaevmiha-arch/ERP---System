import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { Db } from '@/server/db/types';

export const SESSION_COOKIE = 'erp_session';
export const SESSION_TTL_MS = 7 * 86400000;
export type SessionUser = typeof users.$inferSelect;

// Секрет подписи обязателен и не подменяется ничем другим (§5.2.6).
export function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET не задан');
  if (s.length < 32) throw new Error('SESSION_SECRET должен быть не короче 32 символов');
  return s;
}
const sign = (payload: string) => createHmac('sha256', sessionSecret()).update(payload).digest('hex');

// Токен: userId.sessionVersion.expires.hmac. Рост users.session_version отзывает все токены пользователя.
export function signSession(user: { id: string; sessionVersion: number }, now = Date.now()) {
  const payload = `${user.id}.${user.sessionVersion}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export async function verifySessionToken(db: Db, token: string | undefined, now = Date.now()): Promise<SessionUser | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [userId, version, expires, sig] = parts;
  if (!(Number(expires) > now)) return null;
  const expected = sign(`${userId}.${version}.${expires}`);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive || String(user.sessionVersion) !== version) return null;
  return user;
}
