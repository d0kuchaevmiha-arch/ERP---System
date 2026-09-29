import type { NextRequest } from 'next/server';
import { db } from '@/db';
import type { SessionUser } from '@/server/auth/session';
import { DomainError, invalid } from '@/server/domain/errors';
import { runCommand } from '@/server/domain/registry';
import { clientIp } from './client-ip';
import { userFromRequest } from './request-user';

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

// Общий путь HTTP-записи: источник → пользователь (cookie или токен устройства) → команда.
// Заголовок X-Change-Seq — номер журнала изменений после commit: десктоп ждёт, пока его реплика догонит это значение.
export async function commandResponse(req: NextRequest, name: string, input: (body: unknown) => unknown, onSuccess?: (data: unknown, user: SessionUser) => Promise<void> | void) {
  if (foreignOrigin(req)) return errorResponse('Недопустимый источник запроса', 403);
  const who = await userFromRequest(req);
  if (!who) return errorResponse('Войдите в систему', 401);
  try {
    // Необязательный ключ операции (UUID): повтор запроса с тем же ключом не выполняет команду второй раз.
    const key = req.headers.get('idempotency-key');
    if (key !== null && !UUID.test(key)) throw invalid('Idempotency-Key должен быть UUID');
    const meta: { maxSeq?: number } = {};
    const data = await runCommand({ db, actor: who.user, ip: clientIp(req.headers), userAgent: req.headers.get('user-agent'), meta, prov: { opId: key ? key.toLowerCase() : undefined, deviceId: who.deviceId ?? undefined } }, name, input(await readJson(req)));
    await onSuccess?.(data, who.user);
    const headers = meta.maxSeq ? { 'X-Change-Seq': String(meta.maxSeq) } : undefined;
    return Response.json({ data }, { status: 201, headers });
  } catch (e) { return toErrorResponse(e); }
}
