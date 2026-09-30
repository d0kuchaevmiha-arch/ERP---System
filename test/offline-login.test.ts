import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import { registerDevice, verifyDevicePassword } from '@/server/auth/device';
import { checkOffline, LOCK_MS, makeVerifier, MAX_FAILURES, passwordMatches } from '@/client/offline/local-auth';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createUser, PASSWORD } from './helpers/fixtures';

// Офлайн-вход (§7, решение P4 №11).
const DAY = 86_400_000;

describe('офлайн-верификатор', () => {
  const t0 = new Date('2026-10-01T08:00:00Z');
  const v = makeVerifier('Foreman@Test.local', 'пароль-прораба', t0, t0);

  it('пароль не хранится; верный пароль в пределах 7 дней — вход; неверный — отказ', () => {
    expect(JSON.stringify(v)).not.toContain('пароль-прораба');
    expect(v.email).toBe('foreman@test.local');
    const ok = checkOffline(v, 'пароль-прораба', new Date(t0.getTime() + 6 * DAY));
    expect(ok).toMatchObject({ ok: true, daysLeft: 1 });
    expect(checkOffline(v, 'другой', new Date(t0.getTime() + DAY))).toMatchObject({ ok: false, reason: 'bad_password' });
    expect(checkOffline(null, 'x')).toMatchObject({ ok: false, reason: 'none' });
  });

  it('после 7 дней — только онлайн; часы, переведённые назад, окно не продлевают', () => {
    expect(checkOffline(v, 'пароль-прораба', new Date(t0.getTime() + 7 * DAY + 1000))).toMatchObject({ ok: false, reason: 'expired' });
    const seenLate = checkOffline(v, 'пароль-прораба', new Date(t0.getTime() + 6.9 * DAY));
    expect(seenLate.ok).toBe(true);
    // Пользователь вернул часы на 5 дней назад и пытается войти на 8-й день по «реальному» времени.
    const back = checkOffline(seenLate.verifier, 'пароль-прораба', new Date(t0.getTime() + 2 * DAY));
    expect(back.ok).toBe(true); // всё ещё в окне по последнему увиденному времени
    const later = { ...seenLate.verifier!, lastSeenAt: new Date(t0.getTime() + 8 * DAY).toISOString() };
    expect(checkOffline(later, 'пароль-прораба', new Date(t0.getTime() + 3 * DAY))).toMatchObject({ ok: false, reason: 'expired' });
  });

  it(`${MAX_FAILURES} неверных подряд — пауза на минуту, затем снова можно`, () => {
    let cur = v; const at = new Date(t0.getTime() + DAY);
    for (let i = 0; i < MAX_FAILURES; i++) cur = checkOffline(cur, 'нет', at).verifier!;
    expect(checkOffline(cur, 'пароль-прораба', at)).toMatchObject({ ok: false, reason: 'locked' });
    expect(checkOffline(cur, 'пароль-прораба', new Date(at.getTime() + LOCK_MS + 1)).ok).toBe(true);
  });

  it('сверка пароля без окна — для экспорта очереди с отозванного устройства', () => {
    expect(passwordMatches(v, 'пароль-прораба')).toBe(true);
    expect(passwordMatches(v, 'пароль-прораба ')).toBe(false);
  });
});

describe('проверка пароля устройства на сервере', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createMigratedDb(); });
  afterAll(async () => { await t?.drop(); });

  it('верный пароль → пользователь и время сервера; неверный → bad_password; блокировка → device_revoked', async () => {
    const org = await createOrg(t.db);
    const director = await createUser(t.db, org.id, 'director');
    const u = await createUser(t.db, org.id, 'foreman');
    const reg = await registerDevice(t.db, { email: u.email, password: PASSWORD, deviceName: 'ноутбук', appVersion: 'test', ip: null });
    if (!reg.ok) throw new Error(reg.message);
    const ok = await verifyDevicePassword(t.db, { token: reg.token, password: PASSWORD, ip: null });
    expect(ok).toMatchObject({ ok: true, user: { id: u.id, email: u.email } });
    expect(await verifyDevicePassword(t.db, { token: reg.token, password: 'неверный-пароль', ip: null })).toMatchObject({ ok: false, status: 401, code: 'bad_password' });
    expect(await verifyDevicePassword(t.db, { token: 'erpd_чужой', password: PASSWORD, ip: null })).toMatchObject({ ok: false, code: 'device_revoked' });
    await runCommand({ db: t.db, actor: director, ip: null, userAgent: 't' }, 'users.update', { userId: u.id, isActive: false });
    expect(await verifyDevicePassword(t.db, { token: reg.token, password: PASSWORD, ip: null })).toMatchObject({ ok: false, code: 'device_revoked' });
    expect((await t.db.select().from(s.devices)).find(d => d.id === reg.deviceId)?.revokedAt).toBeTruthy();
  });
});
