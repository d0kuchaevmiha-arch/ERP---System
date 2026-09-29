import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { userFromRequest } from '@/server/http/request-user';
import { listUsers } from '@/server/read/users';
import { commandResponse, errorResponse, toErrorResponse } from '@/server/http/command-route';
import { isClientMode } from '@/client/local/session';
import { forwardToServer } from '@/client/local/forward-route';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = (await userFromRequest(req))?.user;
  if (!user) return errorResponse('Войдите в систему', 401);
  if (user.mustChangePassword) return errorResponse('Смените пароль, чтобы продолжить', 403);
  // Пользователи и доступы в реплику не входят — в десктопе это онлайн-функция сервера.
  if (isClientMode()) return forwardToServer(req);
  try { return Response.json({ data: await listUsers(db, user) }); } catch (e) { return toErrorResponse(e); }
}

// Ответ содержит временный пароль — показывается администратору один раз и нигде не хранится в открытом виде.
export async function POST(req: NextRequest) {
  return commandResponse(req, 'users.create', body => body);
}
