import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, devices, users } from '@/db/schema';
import { registerDevice, verifyDeviceToken, SYNC_PROTOCOL, checkProtocol } from '@/server/auth/device';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { listUsers } from '@/server/read/users';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createUser, PASSWORD } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input);
const reg = (email: string, password = PASSWORD) => registerDevice(t.db, { email, password, deviceName: 'Ноутбук прораба', appVersion: '0.4.0', ip: null });
type Ok = { ok: true; deviceId: string; token: string; user: { id: string } };

async function setup() {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const foreman = await createUser(t.db, org.id, 'foreman');
  return { org, director, foreman };
}

describe('регистрация устройства (§6.1)', () => {
  it('верный пароль → токен; на сервере только хеш; токен даёт пользователя; регистрация в аудите', async () => {
    const s = await setup();
    const r = await reg(s.foreman.email) as Ok;
    expect(r.ok).toBe(true);
    expect(r.token).toMatch(/^erpd_[A-Za-z0-9_-]{43}$/);
    const [d] = await t.db.select().from(devices).where(eq(devices.id, r.deviceId));
    expect(d.tokenHash).not.toContain(r.token);
    expect(d).toMatchObject({ userId: s.foreman.id, name: 'Ноутбук прораба', appVersion: '0.4.0', revokedAt: null });
    const who = await verifyDeviceToken(t.db, r.token);
    expect(who?.user.id).toBe(s.foreman.id);
    expect(who?.deviceId).toBe(r.deviceId);
    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, r.deviceId));
    expect(log.map(l => l.action)).toEqual(['register_device']);
    expect(JSON.stringify(log)).not.toContain(r.token);
  });

  it('неверный пароль → 401; временный пароль → 403 «смените пароль»; мусорный токен → нет пользователя', async () => {
    const s = await setup();
    expect(await reg(s.foreman.email, 'wrong-password')).toMatchObject({ ok: false, status: 401 });
    await t.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, s.foreman.id));
    expect(await reg(s.foreman.email)).toMatchObject({ ok: false, status: 403 });
    expect(await verifyDeviceToken(t.db, 'erpd_' + 'x'.repeat(43))).toBeNull();
    expect(await verifyDeviceToken(t.db, 'Bearer что-то')).toBeNull();
  });

  it('отзыв устройства владельцем, блокировка и сброс пароля администратором делают токен недействительным', async () => {
    const s = await setup();
    const a = await reg(s.foreman.email) as Ok;
    await run(s.foreman, 'devices.revoke', { deviceId: a.deviceId });
    expect(await verifyDeviceToken(t.db, a.token)).toBeNull();

    const b = await reg(s.foreman.email) as Ok;
    await run(s.director, 'users.update', { userId: s.foreman.id, isActive: false });
    expect(await verifyDeviceToken(t.db, b.token)).toBeNull();
    await run(s.director, 'users.update', { userId: s.foreman.id, isActive: true });
    expect(await verifyDeviceToken(t.db, b.token)).toBeNull(); // разблокировка не воскрешает отозванное устройство

    const c = await reg(s.foreman.email) as Ok;
    await run(s.director, 'users.resetPassword', { userId: s.foreman.id });
    expect(await verifyDeviceToken(t.db, c.token)).toBeNull();
  });

  it('смена своего пароля устройство не отзывает', async () => {
    const s = await setup();
    const d = await reg(s.foreman.email) as Ok;
    await run(s.foreman, 'auth.changePassword', { currentPassword: PASSWORD, newPassword: 'new-password-777' });
    expect((await verifyDeviceToken(t.db, d.token))?.user.id).toBe(s.foreman.id);
  });

  it('чужое устройство отозвать нельзя (не админ; другая организация — 404); директор своей организации может', async () => {
    const s = await setup(); const other = await setup();
    const d = await reg(s.foreman.email) as Ok;
    const colleague = await createUser(t.db, s.org.id, 'foreman');
    await expect(run(colleague, 'devices.revoke', { deviceId: d.deviceId })).rejects.toMatchObject({ status: 403 });
    await expect(run(other.director, 'devices.revoke', { deviceId: d.deviceId })).rejects.toMatchObject({ status: 404 });
    await run(s.director, 'devices.revoke', { deviceId: d.deviceId });
    expect(await verifyDeviceToken(t.db, d.token)).toBeNull();
  });

  it('список пользователей показывает устройства без хешей токенов', async () => {
    const s = await setup();
    const d = await reg(s.foreman.email) as Ok;
    const list = await listUsers(t.db, s.director);
    const f = list.find(u => u.id === s.foreman.id)!;
    expect(f.devices).toEqual([expect.objectContaining({ id: d.deviceId, name: 'Ноутбук прораба', revokedAt: null })]);
    expect(JSON.stringify(list)).not.toMatch(/tokenHash|token_hash/);
  });
});

describe('версия протокола (§6)', () => {
  it('без заголовка или с другой версией → 426', () => {
    expect(checkProtocol(new Headers())).toMatchObject({ status: 426 });
    expect(checkProtocol(new Headers({ 'x-sync-protocol': '2' }))).toMatchObject({ status: 426 });
    expect(checkProtocol(new Headers({ 'x-sync-protocol': String(SYNC_PROTOCOL) }))).toBeNull();
  });
});
