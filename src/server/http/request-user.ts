import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { SESSION_COOKIE, verifySessionToken, type SessionUser } from '@/server/auth/session';
import { bearerToken, verifyDeviceToken } from '@/server/auth/device';
import { LOCAL_COOKIE, clientEnv, isClientMode, localUser } from '@/client/local/session';

// Кто делает запрос: браузер — по cookie-сессии, десктоп-клиент — по токену устройства (Authorization: Bearer).
// В режиме client (локальный Next десктопа) — только окно приложения со своим секретом.
export type RequestUser = { user: SessionUser; deviceId: string | null };

export async function userFromRequest(req: NextRequest): Promise<RequestUser | null> {
  if (isClientMode()) {
    const user = await localUser(db, req.cookies.get(LOCAL_COOKIE)?.value, clientEnv());
    return user ? { user, deviceId: null } : null;
  }
  const token = bearerToken(req.headers);
  if (token) {
    const d = await verifyDeviceToken(db, token);
    return d ? { user: d.user, deviceId: d.deviceId } : null;
  }
  const user = await verifySessionToken(db, req.cookies.get(SESSION_COOKIE)?.value);
  return user ? { user, deviceId: null } : null;
}
