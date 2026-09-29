import type { NextRequest } from 'next/server';
import { eq, max } from 'drizzle-orm';
import { db } from '@/db';
import { changeLog } from '@/db/schema';
import { bearerToken, checkProtocol } from '@/server/auth/device';
import { userFromRequest } from '@/server/http/request-user';
import { getHub } from '@/server/realtime/instance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25_000;

// Сигналы об изменениях (§6.5): `event: changes data:{maxSeq}` только по объектам пользователя, без данных.
// Клиент в ответ перечитывает данные (браузер — сводку, десктоп в P3 — pull). Авторизация — cookie (device token — P3).
export async function GET(req: NextRequest) {
  // Браузер — cookie; десктоп — токен устройства и заголовок версии протокола.
  const deviceToken = bearerToken(req.headers);
  if (deviceToken) { const proto = checkProtocol(req.headers); if (proto) return Response.json({ error: { message: proto.message } }, { status: proto.status }); }
  const who = async () => (await userFromRequest(req))?.user ?? null;
  const user = await who();
  if (!user) return Response.json({ error: { message: 'Войдите в систему' } }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: { message: 'Смените пароль, чтобы продолжить' } }, { status: 403 });

  const hub = getHub();
  const [{ seq }] = await db.select({ seq: max(changeLog.seq) }).from(changeLog).where(eq(changeLog.organizationId, user.organizationId));
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (text: string) => { if (open) { try { controller.enqueue(encoder.encode(text)); } catch { close(); } } };
      const close = () => {
        if (!open) return;
        open = false; cleanup();
        try { controller.close(); } catch { /* уже закрыт */ }
      };
      const revalidate = async () => {
        const fresh = await who();
        return fresh && !fresh.mustChangePassword ? fresh : null;
      };
      write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ maxSeq: seq ?? 0 })}\n\n`);
      const unsubscribe = await hub.subscribe({ user, revalidate, send: s => write(`event: changes\ndata: ${JSON.stringify(s)}\n\n`), close });
      // Heartbeat держит соединение через прокси и заодно перепроверяет сессию (блокировка → поток закрывается).
      const timer = setInterval(async () => { if (await revalidate().catch(() => null)) write(': ping\n\n'); else close(); }, HEARTBEAT_MS);
      cleanup = () => { clearInterval(timer); unsubscribe(); };
      req.signal.addEventListener('abort', close);
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx: не буферизовать поток (P5 — настройка прокси).
      'X-Accel-Buffering': 'no',
    },
  });
}
