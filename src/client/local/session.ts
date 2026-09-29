import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';

// Локальная сессия десктопа (решение P3 №8): Electron при каждом запуске генерирует секрет, передаёт его
// локальному Next (ERP_LOCAL_SESSION) и ставит cookie только своему окну. Другие программы на 127.0.0.1 данных не получат.
export const LOCAL_COOKIE = 'erp_local';

export const isClientMode = () => process.env.ERP_MODE === 'client';

export type ClientEnv = { serverUrl: string; token: string; userId: string; secret: string };
export function clientEnv(): ClientEnv {
  const { ERP_SERVER_URL: serverUrl, ERP_DEVICE_TOKEN: token, ERP_DEVICE_USER_ID: userId, ERP_LOCAL_SESSION: secret } = process.env;
  if (!serverUrl || !token || !userId || !secret || secret.length < 32) throw new Error('Режим client: не заданы ERP_SERVER_URL, ERP_DEVICE_TOKEN, ERP_DEVICE_USER_ID, ERP_LOCAL_SESSION');
  return { serverUrl, token, userId, secret };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Пользователь устройства из реплики; null — нет cookie окна приложения или пользователь заблокирован.
export async function localUser(db: Db, cookie: string | undefined, env: { secret: string; userId: string }): Promise<SessionUser | null> {
  if (!cookie || !same(cookie, env.secret)) return null;
  const [u] = await db.select().from(users).where(eq(users.id, env.userId)).limit(1);
  return u && u.isActive ? u : null;
}
