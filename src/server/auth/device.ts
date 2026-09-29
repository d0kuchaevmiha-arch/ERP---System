import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { auditLogs, devices, users } from '@/db/schema';
import type { Db } from '@/server/db/types';
import { authenticate } from './login';
import type { SessionUser } from './session';

// Токен устройства (§6.1, решение P3): выдаётся один раз, на сервере хранится только SHA-256.
// Пример из жизни: пропуск на объект — охрана хранит не сам пропуск, а его отпечаток и может его аннулировать.
export const SYNC_PROTOCOL = 1;
const TOKEN_PREFIX = 'erpd_';
const LAST_SYNC_THROTTLE_MS = 60_000;

export const hashDeviceToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => TOKEN_PREFIX + randomBytes(32).toString('base64url');

type Registered = { ok: true; deviceId: string; token: string; user: { id: string; name: string; email: string; role: string; organizationId: string } };
type Refused = { ok: false; status: 401 | 403 | 429; message: string };

export async function registerDevice(db: Db, input: { email: string; password: string; deviceName: string; appVersion: string; ip: string | null }, now = new Date()): Promise<Registered | Refused> {
  const auth = await authenticate(db, { email: input.email, password: input.password, ip: input.ip }, now);
  if (!auth.ok) return auth;
  const u = auth.user;
  if (u.mustChangePassword) return { ok: false, status: 403, message: 'Смените временный пароль в браузере, затем подключите устройство' };
  const token = newToken();
  const [d] = await db.insert(devices).values({ userId: u.id, name: input.deviceName.slice(0, 100), appVersion: input.appVersion.slice(0, 40), tokenHash: hashDeviceToken(token) }).returning({ id: devices.id });
  await db.insert(auditLogs).values({ organizationId: u.organizationId, actorId: u.id, action: 'register_device', entityType: 'device', entityId: d.id, after: { name: input.deviceName, appVersion: input.appVersion }, ip: input.ip, deviceId: d.id });
  return { ok: true, deviceId: d.id, token, user: { id: u.id, name: u.name, email: u.email, role: u.role, organizationId: u.organizationId } };
}

// Пользователь по токену устройства; null — токен неизвестен, устройство отозвано или пользователь заблокирован.
export async function verifyDeviceToken(db: Db, token: string | undefined | null, now = new Date()): Promise<{ user: SessionUser; deviceId: string } | null> {
  if (!token?.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db.select({ user: users, deviceId: devices.id }).from(devices).innerJoin(users, eq(users.id, devices.userId))
    .where(and(eq(devices.tokenHash, hashDeviceToken(token)), isNull(devices.revokedAt))).limit(1);
  if (!row || !row.user.isActive) return null;
  // Время последнего обращения — не чаще раза в минуту, чтобы не писать в БД на каждый запрос.
  await db.update(devices).set({ lastSyncAt: now })
    .where(and(eq(devices.id, row.deviceId), or(isNull(devices.lastSyncAt), lt(devices.lastSyncAt, new Date(now.getTime() - LAST_SYNC_THROTTLE_MS)))));
  return row;
}

export const bearerToken = (headers: Headers) => {
  const h = headers.get('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

// Несовместимая версия протокола → 426: клиент должен обновиться, его очередь при этом не теряется (§6).
export function checkProtocol(headers: Headers) {
  return headers.get('x-sync-protocol') === String(SYNC_PROTOCOL) ? null
    : { status: 426 as const, message: `Требуется версия протокола синхронизации ${SYNC_PROTOCOL}. Обновите приложение.` };
}
