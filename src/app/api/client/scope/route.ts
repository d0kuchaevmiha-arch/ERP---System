import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { isClientMode } from '@/client/local/session';
import { setOfflineScope } from '@/client/local/status';
import { userFromRequest } from '@/server/http/request-user';
import { errorResponse, foreignOrigin } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

// Только десктоп: сохранить набор «Доступно офлайн». null — по умолчанию (все доступные; у директора — пусто).
export async function POST(req: NextRequest) {
  if (!isClientMode()) return errorResponse('Доступно только в приложении', 404);
  if (foreignOrigin(req)) return errorResponse('Недопустимый источник запроса', 403);
  if (!(await userFromRequest(req))) return errorResponse('Войдите в систему', 401);
  const body = await req.json().catch(() => null) as { projects?: unknown } | null;
  const p = body?.projects;
  const projects = p === null ? null : Array.isArray(p) && p.every(x => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)) ? p as string[] : undefined;
  if (projects === undefined) return errorResponse('projects — список id объектов или null', 422);
  await setOfflineScope(db, projects);
  return Response.json({ ok: true });
}
