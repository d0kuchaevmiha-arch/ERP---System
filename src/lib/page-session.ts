import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import type { SessionUser } from '@/server/auth/session';
import { isClientMode } from '@/client/local/session';

type PageSession = { user: SessionUser } | { error: string };

// Сессия для серверных страниц: без входа — на /login, с обязательной сменой пароля — на экран смены.
// Данные читаются только после этой проверки (§5.2.2).
export async function requirePageUser(): Promise<PageSession> {
  let user: SessionUser | null;
  try { user = await currentUser(); }
  catch (e) { return { error: e instanceof Error ? e.message : 'Сервер недоступен' }; }
  // В десктопе вход — через приложение: страница открыта не из его окна или пользователь заблокирован.
  if (!user && isClientMode()) return { error: 'Сессия окна приложения недействительна или пользователь заблокирован — перезапустите приложение' };
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/account/password');
  return { user };
}
