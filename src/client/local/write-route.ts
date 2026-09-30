import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { outbox, syncState } from '@/client/db/schema';
import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';
import { writeLocal } from '@/client/offline/write';
import { errorResponse, toErrorResponse } from '@/server/http/command-route';

// Запись в десктопе (решение P4 №3): офлайн-команды всегда идут через outbox. Есть связь — ждём ответа сервера
// до 5 с (sync-agent отправляет сразу), чтобы показать итог; нет связи или не успели — «сохранено, отправится».
export async function localCommandResponse(name: string, body: unknown, user: SessionUser) {
  try {
    const w = await writeLocal(db, user, name, body);
    const [st] = await db.select({ status: syncState.status }).from(syncState).where(eq(syncState.id, 1));
    const settled = st?.status === 'ok' ? await waitSettled(db, w.opId, 5000) : null;
    if (settled?.status === 'rejected') return errorResponse(settled.error ?? 'Сервер не принял операцию', 422);
    const sync = settled?.status === 'applied' ? 'applied' : settled?.status === 'conflict' ? 'conflict' : 'queued';
    return Response.json({ data: w.data, sync, ...(sync === 'conflict' && { warning: settled?.error ?? 'Требует решения' }) }, { status: 201 });
  } catch (e) { return toErrorResponse(e); }
}

async function waitSettled(d: Db, opId: string, ms: number) {
  const until = Date.now() + ms;
  for (;;) {
    const [o] = await d.select({ status: outbox.status, error: outbox.error }).from(outbox).where(eq(outbox.opId, opId));
    if (o && o.status !== 'pending' && o.status !== 'sending') return o;
    if (Date.now() > until) return null;
    await new Promise(r => setTimeout(r, 100));
  }
}
