import { cookies } from 'next/headers';
import { db } from '@/db';
import { SESSION_COOKIE, verifySessionToken } from '@/server/auth/session';
import { LOCAL_COOKIE, clientEnv, isClientMode, localUser } from '@/client/local/session';

export { hashPassword, verifyPassword } from '@/server/auth/password';
export { signSession } from '@/server/auth/session';

// Сервер — cookie-сессия; десктоп (ERP_MODE=client) — секрет окна приложения и пользователь устройства из реплики.
export async function currentUser() {
  const jar = await cookies();
  if (isClientMode()) return localUser(db, jar.get(LOCAL_COOKIE)?.value, clientEnv());
  return verifySessionToken(db, jar.get(SESSION_COOKIE)?.value);
}
