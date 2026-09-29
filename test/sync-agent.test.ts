import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { eq, sql } from 'drizzle-orm';
import * as s from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { getScope, pull, resolveScope, snapshot } from '@/server/sync/service';
import { SYNC_ENTITY_NAMES } from '@/server/sync/entities';
import { ChangeHub } from '@/server/realtime/hub';
import { runClientMigrations } from '@/client/db/migrate';
import { syncState } from '@/client/db/schema';
import { SyncAgent, initSyncState } from '@/client/sync/agent';
import { REPLICA_TABLES } from '@/client/sync/apply';
import { SyncHttpError, type SyncTransport } from '@/client/sync/transport';
import { DomainError } from '@/server/domain/errors';
import { createEmptyDb, createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

let server: TestDb;
beforeAll(async () => { server = await createMigratedDb(); });
afterAll(async () => { await server?.drop(); });

const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: server.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<{ id: string }>;

// Транспорт «как HTTP», но без сети: каждый вызов заново читает пользователя (как проверка токена), ошибки сервиса → коды HTTP.
function directTransport(userId: string): SyncTransport {
  const me = async () => (await server.db.select().from(s.users).where(eq(s.users.id, userId)))[0];
  const wrap = async <T>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { if (e instanceof DomainError) throw new SyncHttpError(e.message, e.status); throw e; } };
  return {
    scope: async () => { const u = await me(); return { ...(await getScope(server.db, u)), user: { id: u.id, name: u.name, role: u.role, organizationId: u.organizationId } }; },
    snapshot: async (entity, projects, cursor) => wrap(async () => JSON.parse(JSON.stringify(await snapshot(server.db, await resolveScope(server.db, await me(), projects), { entity, cursor, limit: 3 })))),
    pull: async (since, projects) => wrap(async () => JSON.parse(JSON.stringify(await pull(server.db, await resolveScope(server.db, await me(), projects), { since })))),
  };
}

async function device(user: Actor) {
  const local = await createEmptyDb();
  await runClientMigrations(local.pool);
  await initSyncState(local.db, { serverUrl: 'http://test', deviceId: crypto.randomUUID(), userId: user.id, organizationId: user.organizationId, userRole: user.role });
  const agent = new SyncAgent({ db: local.db, transport: directTransport(user.id) });
  return { local, agent };
}
const ids = async (db: TestDb, entity: string) => (await db.db.select({ id: REPLICA_TABLES[entity].id }).from(REPLICA_TABLES[entity])).map(r => r.id as string).sort();

async function world() {
  const a = await createOrg(server.db); const b = await createOrg(server.db);
  const director = await createUser(server.db, a.id, 'director');
  const foreman = await createUser(server.db, a.id, 'foreman');
  const p1 = await createProject(server.db, a.id); const p2 = await createProject(server.db, a.id);
  const pb = await createProject(server.db, b.id);
  await grant(server.db, foreman.id, p1.id, 'edit');
  for (const p of [p1, p2, pb]) for (let i = 0; i < 4; i++) await server.db.insert(s.tasks).values({ projectId: p.id, name: `Работа ${i}` });
  return { a, director, foreman, p1, p2, pb };
}

describe('sync-agent: реплика = то, что пользователь видит на сервере', () => {
  it('первичная загрузка: строки по всем сущностям совпадают с серверным snapshot; пароли не приезжают; даты — даты', async () => {
    const w = await world();
    const { local, agent } = await device(w.foreman);
    try {
      await agent.syncOnce();
      const scope = await resolveScope(server.db, w.foreman, null);
      for (const entity of SYNC_ENTITY_NAMES) {
        const expected: string[] = []; let cursor: string | null = null;
        do { const p = await snapshot(server.db, scope, { entity, cursor }); expected.push(...(p.rows as { id: string }[]).map(r => r.id)); cursor = p.nextCursor; } while (cursor);
        expect(await ids(local, entity), entity).toEqual(expected.sort());
      }
      const users = await local.db.select().from(s.users);
      expect(users.every(u => u.passwordHash === '')).toBe(true);
      const [p] = await local.db.select().from(s.projects);
      expect(p.createdAt).toBeInstanceOf(Date);
      const [st] = await local.db.select().from(syncState);
      expect(st).toMatchObject({ snapshotRequired: false, effectiveScope: [w.p1.id], status: 'ok' });
      expect(st.lastSeq).toBeGreaterThanOrEqual(0);
    } finally { await local.drop(); }
  });

  it('изменение на сервере доезжает через pull и даёт локальный сигнал интерфейсу; повтор ничего не дублирует', async () => {
    const w = await world();
    const { local, agent } = await device(w.foreman);
    const listener = new Client({ connectionString: local.url }); listener.on('error', () => {});
    await listener.connect(); await listener.query('listen erp_changes');
    const signals: string[] = []; listener.on('notification', n => signals.push(n.payload!));
    try {
      await agent.syncOnce();
      const e = await run(w.director, 'expenses.create', { projectId: w.p1.id, category: 'Работы', description: 'С сервера', amount: '3.00' });
      await run(w.director, 'expenses.create', { projectId: w.p2.id, category: 'Работы', description: 'Не для прораба', amount: '4.00' });
      expect(await agent.syncOnce()).toBeGreaterThan(0);
      const rows = await local.db.select().from(s.expenses);
      expect(rows.map(r => r.id)).toEqual([e.id]);
      await agent.syncOnce();
      expect(await local.db.select().from(s.expenses)).toHaveLength(1);
      await new Promise(r => setTimeout(r, 200));
      expect(signals.length).toBeGreaterThan(0);
    } finally { await listener.end(); await local.drop(); }
  });

  it('отзыв доступа: объект и его данные удаляются с ноутбука', async () => {
    const w = await world();
    const { local, agent } = await device(w.foreman);
    try {
      await agent.syncOnce();
      expect(await ids(local, 'tasks')).toHaveLength(4);
      await run(w.director, 'access.remove', { userId: w.foreman.id, projectId: w.p1.id });
      await agent.syncOnce();
      expect(await ids(local, 'projects')).toEqual([]);
      expect(await ids(local, 'tasks')).toEqual([]);
      expect(await ids(local, 'project_access')).toEqual([]);
    } finally { await local.drop(); }
  });

  it('директор: по умолчанию пусто; выбор «Доступно офлайн» загружает выбранный объект, выдача доступа — новый', async () => {
    const w = await world();
    const { local, agent } = await device(w.director);
    try {
      await agent.syncOnce();
      expect(await ids(local, 'projects')).toEqual([]);
      await agent.setOfflineScope([w.p2.id]);
      await agent.syncOnce();
      expect(await ids(local, 'projects')).toEqual([w.p2.id]);
      expect(await ids(local, 'tasks')).toHaveLength(4);

      const f = await device(w.foreman);
      try {
        await f.agent.syncOnce();
        await run(w.director, 'access.set', { userId: w.foreman.id, projectId: w.p2.id, permission: 'view' });
        await f.agent.syncOnce();
        expect(await ids(f.local, 'projects')).toEqual([w.p1.id, w.p2.id].sort());
        expect(await ids(f.local, 'tasks')).toHaveLength(8);
      } finally { await f.local.drop(); }
    } finally { await local.drop(); }
  });

  it('журнал на сервере очищен дальше, чем отстал клиент (410) — агент сам загружает всё заново', async () => {
    const w = await world();
    const { local, agent } = await device(w.foreman);
    try {
      await agent.syncOnce();
      const e = await run(w.director, 'expenses.create', { projectId: w.p1.id, category: 'Работы', description: 'Пока клиент спал', amount: '1.00' });
      await server.db.execute(sql`update change_log set changed_at = now() - interval '91 days' where organization_id = ${w.a.id}`);
      await new ChangeHub({ connectionString: server.url, db: server.db, log: () => {} }).prune();
      await agent.syncOnce();
      expect(await ids(local, 'expenses')).toEqual([e.id]);
    } finally { await local.drop(); }
  });

  it('отозванное устройство (401): статус revoked, реплика не трогается', async () => {
    const w = await world();
    const { local, agent } = await device(w.foreman);
    try {
      await agent.syncOnce();
      const revoked = new SyncAgent({ db: local.db, transport: { ...directTransport(w.foreman.id), pull: async () => { throw new SyncHttpError('Устройство отозвано', 401); } } });
      await expect(revoked.syncOnce()).rejects.toBeInstanceOf(SyncHttpError);
      const [st] = await local.db.select().from(syncState);
      expect(st.status).toBe('revoked');
      expect(await ids(local, 'projects')).toEqual([w.p1.id]);
    } finally { await local.drop(); }
  });
});
