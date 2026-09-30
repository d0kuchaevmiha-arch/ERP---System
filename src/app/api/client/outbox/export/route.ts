import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { isClientMode } from '@/client/local/session';
import { exportFileName, exportOutbox } from '@/client/offline/export';
import { userFromRequest } from '@/server/http/request-user';
import { errorResponse } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

// Только десктоп: «Экспорт очереди в файл» (§8) — всё, что ещё не принято сервером. Окно сохранит файл через диалог.
export async function GET(req: NextRequest) {
  if (!isClientMode()) return errorResponse('Доступно только в приложении', 404);
  if (!(await userFromRequest(req))) return errorResponse('Войдите в систему', 401);
  const data = await exportOutbox(db);
  const name = exportFileName();
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="erp-outbox.json"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'no-store' },
  });
}
