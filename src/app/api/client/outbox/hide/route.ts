import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { isClientMode } from '@/client/local/session';
import { hideRejected } from '@/client/offline/read';
import { userFromRequest } from '@/server/http/request-user';
import { errorResponse, foreignOrigin } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

// Только десктоп: скрыть отклонённую операцию с экрана «Не принято сервером» (из очереди и экспорта она не пропадает).
export async function POST(req: NextRequest) {
  if (!isClientMode()) return errorResponse('Доступно только в приложении', 404);
  if (foreignOrigin(req)) return errorResponse('Недопустимый источник запроса', 403);
  if (!(await userFromRequest(req))) return errorResponse('Войдите в систему', 401);
  const body = await req.json().catch(() => null) as { opId?: unknown } | null;
  if (typeof body?.opId !== 'string') return errorResponse('opId обязателен', 422);
  if (!(await hideRejected(db, body.opId))) return errorResponse('Операция не найдена или не отклонена', 404);
  return Response.json({ ok: true });
}
