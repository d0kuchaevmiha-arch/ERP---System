import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import type { SessionUser } from '@/server/auth/session';

type PageSession = { user: SessionUser } | { error: string };

// Сессия для серверных страниц: без входа — на /login, с обязательной сменой пароля — на экран смены.
// Данные читаются только после этой проверки (§5.2.2).
export async function requirePageUser(): Promise<PageSession> {
  let user: SessionUser | null;
  try { user = await currentUser(); }
  catch (e) { return { error: e instanceof Error ? e.message : 'Сервер недоступен' }; }
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/account/password');
  return { user };
}
