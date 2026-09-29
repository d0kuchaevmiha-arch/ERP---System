import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createUser, PASSWORD } from './helpers/fixtures';
import { authenticate } from '@/server/auth/login';
import { clientIp } from '@/server/http/client-ip';

let t: TestDb;
let other: Pool; // второй «экземпляр приложения» со своим пулом
beforeAll(async () => { t = await createMigratedDb(); other = new Pool({ connectionString: t.url, max: 2 }); });
afterAll(async () => { await other?.end(); await t?.drop(); });

async function user() { const org = await createOrg(t.db); return createUser(t.db, org.id, 'foreman'); }
const T0 = new Date('2026-09-29T10:00:00Z');
const plus = (min: number) => new Date(T0.getTime() + min * 60000);

describe('вход', () => {
  it('верный пароль — пользователь; email без учёта регистра', async () => {
    const u = await user();
    const r = await authenticate(t.db, { email: u.email.toUpperCase(), password: PASSWORD, ip: '10.0.0.1' }, T0);
    expect(r.ok && r.user.id).toBe(u.id);
  });

  it('заблокированный пользователь не входит даже с верным паролем', async () => {
    const u = await user();
    await t.db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    const r = await authenticate(t.db, { email: u.email, password: PASSWORD, ip: '10.0.0.1' }, T0);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it('10 неудач → 429, виден другому экземпляру; окно 15 минут истекает', async () => {
    const u = await user();
    for (let i = 0; i < 10; i++) {
      const r = await authenticate(t.db, { email: u.email, password: 'wrong', ip: '10.0.0.2' }, T0);
      expect(r).toMatchObject({ ok: false, status: 401 });
    }
    const second = await authenticate(drizzle(other), { email: u.email, password: PASSWORD, ip: '10.0.0.2' }, plus(1));
    expect(second).toMatchObject({ ok: false, status: 429 });
    // другой IP для того же email не заблокирован
    expect((await authenticate(t.db, { email: u.email, password: PASSWORD, ip: '10.0.0.3' }, plus(1))).ok).toBe(true);
    // после окна — снова можно
    expect((await authenticate(t.db, { email: u.email, password: PASSWORD, ip: '10.0.0.2' }, plus(16))).ok).toBe(true);
  });

  it('успешный вход сбрасывает счётчик', async () => {
    const u = await user();
    for (let i = 0; i < 9; i++) await authenticate(t.db, { email: u.email, password: 'wrong', ip: '10.0.0.4' }, T0);
    expect((await authenticate(t.db, { email: u.email, password: PASSWORD, ip: '10.0.0.4' }, T0)).ok).toBe(true);
    for (let i = 0; i < 9; i++) await authenticate(t.db, { email: u.email, password: 'wrong', ip: '10.0.0.4' }, T0);
    expect((await authenticate(t.db, { email: u.email, password: PASSWORD, ip: '10.0.0.4' }, T0)).ok).toBe(true);
  });
});

describe('IP клиента', () => {
  const saved = process.env.TRUSTED_PROXY;
  afterEach(() => { if (saved === undefined) delete process.env.TRUSTED_PROXY; else process.env.TRUSTED_PROXY = saved; });
  const h = (xff: string) => new Headers({ 'x-forwarded-for': xff });

  it('без TRUSTED_PROXY заголовок X-Forwarded-For игнорируется', () => {
    delete process.env.TRUSTED_PROXY;
    expect(clientIp(h('1.2.3.4'))).toBeNull();
  });
  it('с TRUSTED_PROXY берётся адрес, добавленный нашим прокси (крайний правый)', () => {
    process.env.TRUSTED_PROXY = '1';
    expect(clientIp(h('6.6.6.6, 10.1.1.1'))).toBe('10.1.1.1');
  });
});
