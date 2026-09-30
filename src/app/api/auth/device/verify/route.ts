import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { bearerToken, checkProtocol, verifyDevicePassword } from '@/server/auth/device';
import { clientIp } from '@/server/http/client-ip';
import { errorResponse } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

// POST /api/auth/device/verify {password} + токен устройства → {user, serverTime} (§7, офлайн-вход P4).
export async function POST(req: NextRequest) {
  const proto = checkProtocol(req.headers);
  if (proto) return errorResponse(proto.message, proto.status);
  const body = await req.json().catch(() => ({})) as { password?: unknown };
  if (typeof body.password !== 'string' || !body.password) return errorResponse('Введите пароль', 422);
  const r = await verifyDevicePassword(db, { token: bearerToken(req.headers), password: body.password, ip: clientIp(req.headers) });
  if (!r.ok) return Response.json({ error: { message: r.message, code: r.code } }, { status: r.status });
  return Response.json({ user: r.user, serverTime: r.serverTime });
}
