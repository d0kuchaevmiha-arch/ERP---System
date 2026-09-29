import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { checkProtocol, registerDevice } from '@/server/auth/device';
import { clientIp } from '@/server/http/client-ip';
import { errorResponse } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

// Регистрация десктоп-клиента (§6.1): email + пароль → токен устройства (выдаётся один раз).
export async function POST(req: NextRequest) {
  const proto = checkProtocol(req.headers);
  if (proto) return errorResponse(proto.message, proto.status);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { email, password, deviceName, appVersion } = body;
  if (typeof email !== 'string' || typeof password !== 'string' || typeof deviceName !== 'string' || typeof appVersion !== 'string' || !deviceName.trim())
    return errorResponse('Укажите email, пароль, имя устройства и версию приложения', 422);
  const r = await registerDevice(db, { email, password, deviceName: deviceName.trim(), appVersion, ip: clientIp(req.headers) });
  if (!r.ok) return errorResponse(r.message, r.status);
  return Response.json({ deviceId: r.deviceId, token: r.token, user: r.user }, { status: 201 });
}
