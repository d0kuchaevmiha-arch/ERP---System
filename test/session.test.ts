import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createUser } from './helpers/fixtures';
import { sessionSecret, signSession, verifySessionToken } from '@/server/auth/session';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

async function newUser() {
  const org = await createOrg(t.db);
  return createUser(t.db, org.id, 'foreman');
}

describe('сессия', () => {
  it('подписанный токен возвращает пользователя', async () => {
    const u = await newUser();
    const user = await verifySessionToken(t.db, signSession(u));
    expect(user?.id).toBe(u.id);
  });

  it('подделанная подпись, истёкший или старый формат — нет сессии', async () => {
    const u = await newUser();
    const token = signSession(u);
    expect(await verifySessionToken(t.db, token.slice(0, -2) + (token.endsWith('00') ? '11' : '00'))).toBeNull();
    expect(await verifySessionToken(t.db, signSession(u, Date.now() - 8 * 86400000))).toBeNull();
    const [, , exp, sig] = token.split('.');
    expect(await verifySessionToken(t.db, `${u.id}.${exp}.${sig}`)).toBeNull();
    expect(await verifySessionToken(t.db, undefined)).toBeNull();
    expect(await verifySessionToken(t.db, 'мусор')).toBeNull();
  });

  it('заблокированный пользователь теряет сессию сразу', async () => {
    const u = await newUser();
    const token = signSession(u);
    await t.db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    expect(await verifySessionToken(t.db, token)).toBeNull();
  });

  it('рост session_version отзывает все выданные токены', async () => {
    const u = await newUser();
    const token = signSession(u);
    await t.db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, u.id));
    expect(await verifySessionToken(t.db, token)).toBeNull();
    const [fresh] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect((await verifySessionToken(t.db, signSession(fresh)))?.id).toBe(u.id);
  });
});

describe('SESSION_SECRET', () => {
  const saved = { secret: process.env.SESSION_SECRET, demo: process.env.DEMO_PASSWORD };
  afterEach(() => { process.env.SESSION_SECRET = saved.secret; process.env.DEMO_PASSWORD = saved.demo; });

  it('без секрета — ошибка, фолбэка на DEMO_PASSWORD нет', () => {
    delete process.env.SESSION_SECRET;
    process.env.DEMO_PASSWORD = 'x'.repeat(40);
    expect(() => sessionSecret()).toThrow(/SESSION_SECRET/);
  });

  it('короткий секрет (< 32 символов) — ошибка', () => {
    process.env.SESSION_SECRET = 'short';
    expect(() => sessionSecret()).toThrow(/32/);
  });
});
