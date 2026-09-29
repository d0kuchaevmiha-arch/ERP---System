import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { currentUser } from '@/lib/session';
import { listUsers } from '@/server/read/users';
import { commandResponse, errorResponse, toErrorResponse } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return errorResponse('Войдите в систему', 401);
  if (user.mustChangePassword) return errorResponse('Смените пароль, чтобы продолжить', 403);
  try { return Response.json({ data: await listUsers(db, user) }); } catch (e) { return toErrorResponse(e); }
}

// Ответ содержит временный пароль — показывается администратору один раз и нигде не хранится в открытом виде.
export async function POST(req: NextRequest) {
  return commandResponse(req, 'users.create', body => body);
}
