import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { bearerToken, checkProtocol, verifyDeviceToken } from '@/server/auth/device';
import { DomainError } from '@/server/domain/errors';
import { errorResponse } from './command-route';
import type { RequestUser } from './request-user';

// /api/sync/* — только для десктоп-клиента: токен устройства + версия протокола (§6).
export async function syncUser(req: NextRequest): Promise<RequestUser | Response> {
  const proto = checkProtocol(req.headers);
  if (proto) return errorResponse(proto.message, proto.status);
  const d = await verifyDeviceToken(db, bearerToken(req.headers));
  if (!d) return errorResponse('Устройство не подключено или отозвано — войдите заново', 401);
  if (d.user.mustChangePassword) return errorResponse('Смените пароль, чтобы продолжить', 403);
  return { user: d.user, deviceId: d.deviceId };
}

// projects=a,b — выбранный офлайн-набор; параметра нет — набор по умолчанию; пустое значение — ни одного объекта.
export function requestedProjects(req: NextRequest): string[] | null {
  const raw = req.nextUrl.searchParams.get('projects');
  if (raw === null) return null;
  return raw.split(',').map(s => s.trim()).filter(s => /^[0-9a-f-]{36}$/i.test(s));
}

export function syncError(e: unknown) {
  if (e instanceof DomainError) return Response.json({ error: { message: e.message, code: e.code } }, { status: e.status });
  throw e;
}
