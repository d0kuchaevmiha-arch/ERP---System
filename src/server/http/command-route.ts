import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { currentUser } from '@/lib/session';
import type { SessionUser } from '@/server/auth/session';
import { DomainError, invalid } from '@/server/domain/errors';
import { runCommand } from '@/server/domain/registry';
import { clientIp } from './client-ip';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function errorResponse(message: string, status = 400) { return Response.json({ error: { message } }, { status }); }

export function toErrorResponse(e: unknown) {
  if (e instanceof DomainError) return errorResponse(e.message, e.status);
  return errorResponse(e instanceof Error ? e.message : 'Ошибка операции', 400);
}

// Запрос с другого сайта отклоняется (защита от CSRF поверх SameSite-cookie).
export function foreignOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  return Boolean(origin && origin !== req.nextUrl.origin);
}

// Пустое тело (например, у DELETE) — пустой объект; иначе — строго JSON.
export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw invalid('Тело запроса должно быть JSON'); }
}

// Общий путь HTTP-записи: источник → сессия → команда. mapResult позволяет, например, выставить новую cookie.
export async function commandResponse(req: NextRequest, name: string, input: (body: unknown) => unknown, onSuccess?: (data: unknown, user: SessionUser) => Promise<void> | void) {
  if (foreignOrigin(req)) return errorResponse('Недопустимый источник запроса', 403);
  const user = await currentUser();
  if (!user) return errorResponse('Войдите в систему', 401);
  try {
    // Необязательный ключ операции (UUID): повтор запроса с тем же ключом не выполняет команду второй раз.
    const key = req.headers.get('idempotency-key');
    if (key !== null && !UUID.test(key)) throw invalid('Idempotency-Key должен быть UUID');
    const data = await runCommand({ db, actor: user, ip: clientIp(req.headers), userAgent: req.headers.get('user-agent'), prov: key ? { opId: key.toLowerCase() } : undefined }, name, input(await readJson(req)));
    await onSuccess?.(data, user);
    return Response.json({ data }, { status: 201 });
  } catch (e) { return toErrorResponse(e); }
}
