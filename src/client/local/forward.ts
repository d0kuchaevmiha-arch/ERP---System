import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { syncState } from '@/client/db/schema';
import type { Db } from '@/server/db/types';

// Запись в десктопе (P3, решение №1): команда уходит на сервер с токеном устройства и ключом операции,
// ответ пользователю — когда реплика догнала изменение (X-Change-Seq), чтобы экран сразу показал результат.
// Пример из жизни: заявку отдают в центральную канцелярию и ждут, пока копия придёт в папку филиала.

export const AGENT_CHANNEL = 'erp_agent';
export type Forwarded = { status: number; body: string; contentType: string };

export async function forwardCommand(opts: {
  db: Db; serverUrl: string; token: string; method: string; path: string; body: string | null;
  idempotencyKey?: string | null; waitMs?: number; timeoutMs?: number;
}): Promise<Forwarded> {
  let r: Response;
  try {
    r = await fetch(new URL(opts.path, opts.serverUrl), {
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
        'X-Sync-Protocol': '1',
        // Ключ операции обязателен при пересылке: повтор после сбоя сети не создаст дубль на сервере.
        'Idempotency-Key': opts.idempotencyKey || randomUUID(),
      },
      body: opts.method === 'GET' || opts.method === 'HEAD' ? undefined : opts.body ?? undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch {
    return offline();
  }
  const body = await r.text();
  const seq = Number(r.headers.get('x-change-seq'));
  if (r.ok && seq > 0) {
    // Разбудить sync-agent (он в отдельном процессе) и дождаться, пока реплика получит это изменение.
    await opts.db.execute(sql`select pg_notify(${AGENT_CHANNEL}, 'pull')`).catch(() => {});
    await waitForSeq(opts.db, seq, opts.waitMs ?? 5000);
  }
  if (r.status === 401) return json(401, 'Устройство отозвано или сессия на сервере недействительна — подключите устройство заново');
  return { status: r.status, body, contentType: r.headers.get('content-type') ?? 'application/json' };
}

export async function waitForSeq(db: Db, seq: number, waitMs: number) {
  const until = Date.now() + waitMs;
  for (;;) {
    const [st] = await db.select({ lastSeq: syncState.lastSeq }).from(syncState).where(eq(syncState.id, 1));
    if (st && st.lastSeq >= seq) return true;
    if (Date.now() > until) return false;
    await new Promise(r => setTimeout(r, 100));
  }
}

const json = (status: number, message: string): Forwarded => ({ status, body: JSON.stringify({ error: { message } }), contentType: 'application/json' });
const offline = () => json(503, 'Нет связи с сервером: запись сейчас недоступна, просмотр данных работает');
