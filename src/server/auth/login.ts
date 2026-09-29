import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { Db } from '@/server/db/types';
import { hashPassword, verifyPassword } from './password';
import type { SessionUser } from './session';
import { clearLoginFailures, isLoginBlocked, loginKey, registerLoginFailure } from './rate-limit';

// Для несуществующего email тоже считаем scrypt, чтобы время ответа не выдавало, есть ли такой пользователь.
let dummyHash: string | undefined;

type Result = { ok: true; user: SessionUser } | { ok: false; status: 401 | 429; message: string };

export async function authenticate(db: Db, input: { email: string; password: string; ip: string | null }, now = new Date()): Promise<Result> {
  const email = input.email.toLowerCase().trim();
  const key = loginKey(email, input.ip);
  if (await isLoginBlocked(db, key, now)) return { ok: false, status: 429, message: 'Слишком много попыток. Попробуйте позже.' };
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const passwordOk = verifyPassword(input.password, user?.passwordHash ?? (dummyHash ??= hashPassword('dummy-password')));
  if (!user || !user.isActive || !passwordOk) {
    await registerLoginFailure(db, key, now);
    return { ok: false, status: 401, message: 'Неверный email или пароль' };
  }
  await clearLoginFailures(db, key);
  return { ok: true, user };
}
