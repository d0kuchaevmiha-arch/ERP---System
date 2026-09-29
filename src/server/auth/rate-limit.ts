import { eq, lt, sql } from 'drizzle-orm';
import { loginAttempts } from '@/db/schema';
import type { Db } from '@/server/db/types';

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

// Ключ — email+ip (без доверенного прокси IP неизвестен, тогда ключ фактически по email).
export const loginKey = (email: string, ip: string | null) => `${email}|${ip ?? '-'}`;

export async function isLoginBlocked(db: Db, key: string, now: Date) {
  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key));
  return Boolean(row && row.until > now && row.count >= MAX_FAILURES);
}

export async function registerLoginFailure(db: Db, key: string, now: Date) {
  const until = new Date(now.getTime() + WINDOW_MS);
  await db.insert(loginAttempts).values({ key, count: 1, until }).onConflictDoUpdate({
    target: loginAttempts.key,
    set: {
      count: sql`case when ${loginAttempts.until} > ${now.toISOString()}::timestamptz then ${loginAttempts.count} + 1 else 1 end`,
      until,
    },
  });
  await db.delete(loginAttempts).where(lt(loginAttempts.until, new Date(now.getTime() - WINDOW_MS)));
}

export async function clearLoginFailures(db: Db, key: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.key, key));
}
