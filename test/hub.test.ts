import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { changeLog, users } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { ChangeHub } from '@/server/realtime/hub';
import type { SessionUser } from '@/server/auth/session';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

let t: TestDb;
let hub: ChangeHub;
beforeAll(async () => { t = await createMigratedDb(); hub = new ChangeHub({ connectionString: t.url, db: t.db, log: () => {} }); await hub.start(); });
afterAll(async () => { await hub?.stop(); await t?.drop(); });

const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<{ id: string }>;
const reload = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0] ?? null;

// Подписчик как SSE-поток: копит полученные сигналы, сессию перепроверяет по БД.
async function listen(user: SessionUser) {
  const got: { maxSeq: number; at: number }[] = [];
  let closed = false;
  await hub.subscribe({
    user,
    revalidate: async () => { const u = await reload(user.id); return u && u.isActive && u.sessionVersion === user.sessionVersion ? u : null; },
    send: s => got.push({ ...s, at: Date.now() }),
    close: () => { closed = true; },
  });
  return { got, isClosed: () => closed };
}
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function waitUntil(fn: () => boolean, ms = 3000) {
  const until = Date.now() + ms;
  while (!fn()) { if (Date.now() > until) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20)); }
}

async function world() {
  const a = await createOrg(t.db); const b = await createOrg(t.db);
  const director = await createUser(t.db, a.id, 'director');
  const pm = await createUser(t.db, a.id, 'project_manager');
  const foreman = await createUser(t.db, a.id, 'foreman');
  const directorB = await createUser(t.db, b.id, 'director');
  const p1 = await createProject(t.db, a.id); const p2 = await createProject(t.db, a.id);
  await grant(t.db, pm.id, p1.id, 'edit');
  return { a, director, pm, foreman, directorB, p1, p2 };
}

describe('хаб изменений и сигналы (§6.5)', () => {
  it('изменение одного пользователя доходит до другого быстрее секунды, с maxSeq из журнала', async () => {
    const w = await world();
    const pm = await listen(w.pm);
    const started = Date.now();
    const row = await run(w.director, 'budgets.create', { projectId: w.p1.id, category: 'Работы', amount: '1.00' });
    await waitUntil(() => pm.got.length > 0);
    expect(pm.got[0].at - started).toBeLessThan(1000);
    const [c] = await t.db.select().from(changeLog).where(eq(changeLog.entityId, row.id));
    expect(pm.got[0].maxSeq).toBe(c.seq);
  });

  it('чужая организация и объект без доступа сигнал не получают', async () => {
    const w = await world();
    const foreign = await listen(w.directorB);
    const pm = await listen(w.pm);
    const foreman = await listen(w.foreman);
    await run(w.director, 'budgets.create', { projectId: w.p2.id, category: 'Работы', amount: '1.00' });
    await settle();
    expect(foreign.got).toEqual([]);
    expect(pm.got).toEqual([]);
    expect(foreman.got).toEqual([]);
  });

  it('выдача доступа начинает доставку по объекту без переподключения', async () => {
    const w = await world();
    const foreman = await listen(w.foreman);
    await run(w.director, 'access.set', { userId: w.foreman.id, projectId: w.p2.id, permission: 'view' });
    await waitUntil(() => foreman.got.length === 1); // сигнал уровня организации
    await run(w.director, 'budgets.create', { projectId: w.p2.id, category: 'Работы', amount: '1.00' });
    await waitUntil(() => foreman.got.length === 2);
  });

  it('блокировка пользователя закрывает его поток', async () => {
    const w = await world();
    const pm = await listen(w.pm);
    await run(w.director, 'users.update', { userId: w.pm.id, isActive: false });
    await waitUntil(() => pm.isClosed());
  });

  it('обрыв LISTEN-соединения: хаб переподключается и доставляет дальше', async () => {
    const w = await world();
    const d = await listen(w.director);
    const pid = await hub.listenerPid();
    await t.pool.query('select pg_terminate_backend($1)', [pid]);
    await waitUntil(() => d.got.some(s => s.maxSeq === -1), 5000); // «могло измениться» после переподключения
    await run(w.pm, 'budgets.create', { projectId: w.p1.id, category: 'Работы', amount: '1.00' });
    await waitUntil(() => d.got.some(s => s.maxSeq > 0), 3000);
  });

  it('очистка журнала: записи старше 90 дней удаляются, свежие остаются', async () => {
    const w = await world();
    await run(w.director, 'budgets.create', { projectId: w.p1.id, category: 'Работы', amount: '1.00' });
    await t.db.execute(sql`update change_log set changed_at = now() - interval '91 days' where organization_id = ${w.a.id}`);
    await run(w.director, 'budgets.create', { projectId: w.p1.id, category: 'Работы', amount: '2.00' });
    await hub.prune();
    const left = await t.db.select().from(changeLog).where(eq(changeLog.organizationId, w.a.id));
    expect(left).toHaveLength(1);
  });
});
