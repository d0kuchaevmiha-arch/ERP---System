import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { clientEnv } from './session';
import { forwardCommand } from './forward';

// Локальный Next десктопа: запрос окна приложения → тот же путь на сервере организации (запись, админ-функции).
export async function forwardToServer(req: NextRequest) {
  const env = clientEnv();
  const r = await forwardCommand({
    db, serverUrl: env.serverUrl, token: env.token, method: req.method,
    path: req.nextUrl.pathname + req.nextUrl.search,
    body: req.method === 'GET' ? null : await req.text(),
    idempotencyKey: req.headers.get('idempotency-key'),
  });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.contentType } });
}
