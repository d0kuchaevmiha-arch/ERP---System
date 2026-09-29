import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { budgetLines, expenses, materials, notifications, stockMovements, tasks, warehouses } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { getScope, pull, resolveScope, snapshot } from '@/server/sync/service';
import { SYNC_ENTITY_NAMES } from '@/server/sync/entities';
import { ChangeHub } from '@/server/realtime/hub';
import type { SessionUser } from '@/server/auth/session';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

let t: TestDb;
const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<{ id: string }>;

async function world() {
  const a = await createOrg(t.db); const b = await createOrg(t.db);
  const director = await createUser(t.db, a.id, 'director');
  const foreman = await createUser(t.db, a.id, 'foreman');
  const directorB = await createUser(t.db, b.id, 'director');
  const p1 = await createProject(t.db, a.id, { name: 'Открытый объект' });
  const p2 = await createProject(t.db, a.id, { name: 'Секретный объект P2' });
  const pb = await createProject(t.db, b.id, { name: 'Объект чужой организации' });
  await grant(t.db, foreman.id, p1.id, 'edit');
  for (const p of [p1, p2, pb]) {
    await t.db.insert(tasks).values({ projectId: p.id, name: `Работа ${p.name}` });
    await t.db.insert(budgetLines).values({ projectId: p.id, category: 'Работы', amount: '100' });
    await t.db.insert(expenses).values({ projectId: p.id, category: 'Работы', description: `Расход ${p.name}`, amount: '10', incurredAt: '2026-09-01' });
  }
  const [m] = await t.db.insert(materials).values({ organizationId: a.id, sku: 'M', name: 'Материал A' }).returning();
  const [w2] = await t.db.insert(warehouses).values({ organizationId: a.id, projectId: p2.id, name: 'Склад P2' }).returning();
  await t.db.insert(stockMovements).values({ materialId: m.id, warehouseId: w2.id, projectId: p2.id, type: 'receipt', quantity: '7', note: 'Секретная приёмка P2' });
  await t.db.insert(materials).values({ organizationId: b.id, sku: 'M', name: 'Материал B' });
  await t.db.insert(notifications).values([{ userId: foreman.id, title: 'Прорабу' }, { userId: director.id, title: 'Директору' }]);
  return { a, b, director, foreman, directorB, p1, p2, pb, m };
}
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { t = await createMigratedDb(); W = await world(); });
afterAll(async () => { await t?.drop(); });

async function fullSnapshot(user: SessionUser, requested: string[] | null) {
  const scope = await resolveScope(t.db, user, requested);
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const entity of SYNC_ENTITY_NAMES) {
    out[entity] = [];
    let cursor: string | null = null;
    do { const page = await snapshot(t.db, scope, { entity, cursor, limit: 2 }); out[entity].push(...page.rows as Record<string, unknown>[]); cursor = page.nextCursor; } while (cursor);
  }
  return out;
}

describe('офлайн-набор (§10)', () => {
  it('по умолчанию — доступные объекты; у директора — пусто; запрошенное пересекается с доступом', async () => {
    expect((await resolveScope(t.db, W.foreman, null)).projectIds).toEqual([W.p1.id]);
    expect((await resolveScope(t.db, W.director, null)).projectIds).toEqual([]);
    expect((await resolveScope(t.db, W.foreman, [W.p1.id, W.p2.id, W.pb.id])).projectIds).toEqual([W.p1.id]);
    const s = await getScope(t.db, W.director);
    expect(s).toMatchObject({ orgWide: true, defaultScope: [] });
    expect(s.available.map(p => p.id).sort()).toEqual([W.p1.id, W.p2.id].sort());
  });
});

describe('snapshot — только видимое (§6.2)', () => {
  it('прораб: ничего из чужой организации и объекта без доступа; без хешей паролей и аудита', async () => {
    const snap = await fullSnapshot(W.foreman, null);
    const text = JSON.stringify(snap);
    // id объекта P2 виден только как склад организации (так же онлайн); строки P2 и его данные — нет.
    for (const secret of [W.b.id, W.pb.id, 'Секретная приёмка P2', 'Секретный объект P2', 'Объект чужой организации', 'Материал B', 'Директору', W.directorB.id])
      expect(text, secret).not.toContain(secret);
    expect(text).not.toMatch(/passwordHash|password_hash|sessionVersion|tokenHash/);
    expect(snap.projects.map(p => p.id)).toEqual([W.p1.id]);
    for (const e of ['tasks', 'budget_lines', 'expenses', 'purchases', 'contracts', 'task_progress_log']) expect(JSON.stringify(snap[e]), e).not.toContain(W.p2.id);
    expect(snap.stock_movements[0]).toMatchObject({ quantity: '7.000', projectId: null, note: null });
    expect(snap.notifications.map(n => n.title)).toEqual(['Прорабу']);
    expect(snap.project_access).toHaveLength(1);
    expect(snap).not.toHaveProperty('audit_logs');
  });

  it('движения — всех складов организации (остатки как на сервере); справочники — организации', async () => {
    const snap = await fullSnapshot(W.foreman, null);
    expect(snap.stock_movements.map(m => m.quantity)).toEqual(['7.000']);
    expect(snap.materials.map(m => m.name)).toEqual(['Материал A']);
    expect(snap.users.every(u => u.organizationId === W.a.id)).toBe(true);
    expect(snap.users.filter(u => u.email).map(u => u.id)).toEqual([W.foreman.id]);
  });

  it('директор с выбранным набором получает только выбранные объекты', async () => {
    const snap = await fullSnapshot(W.director, [W.p2.id]);
    expect(snap.projects.map(p => p.id)).toEqual([W.p2.id]);
    expect(snap.tasks.every(x => x.projectId === W.p2.id)).toBe(true);
  });
});

describe('pull — изменения (§6.3)', () => {
  it('новое в своём объекте приходит, в чужом — нет; повторные изменения одной строки — одна запись с последней версией', async () => {
    const scope = await resolveScope(t.db, W.foreman, null);
    const { snapshotSeq } = await snapshot(t.db, scope, { entity: 'projects' });
    const own = await run(W.director, 'budgets.create', { projectId: W.p1.id, category: 'Работы', amount: '5.00' });
    await run(W.director, 'budgets.create', { projectId: W.p2.id, category: 'Работы', amount: '6.00' });
    const [task] = await t.db.select().from(tasks).where(sql`${tasks.projectId} = ${W.p1.id}`);
    await run(W.foreman, 'progress.set', { taskId: task.id, progress: 10 });
    await run(W.foreman, 'progress.set', { taskId: task.id, progress: 20 });
    const r = await pull(t.db, scope, { since: snapshotSeq });
    const text = JSON.stringify(r);
    expect(text).not.toContain(W.p2.id);
    expect(r.changes.filter(c => c.entity === 'budget_lines').map(c => c.id)).toEqual([own.id]);
    const taskChanges = r.changes.filter(c => c.entity === 'tasks');
    expect(taskChanges).toHaveLength(1);
    expect(taskChanges[0].row).toMatchObject({ progress: 20 });
    expect(r.hasMore).toBe(false);
    expect(r.nextSeq).toBeGreaterThan(snapshotSeq);
  });

  it('страницы: hasMore и nextSeq; повтор с nextSeq продолжает', async () => {
    const scope = await resolveScope(t.db, W.foreman, null);
    const { snapshotSeq } = await snapshot(t.db, scope, { entity: 'projects' });
    for (let i = 0; i < 3; i++) await run(W.director, 'expenses.create', { projectId: W.p1.id, category: 'Работы', description: `Страница ${i}`, amount: '1.00' });
    const first = await pull(t.db, scope, { since: snapshotSeq, limit: 2 });
    expect(first.hasMore).toBe(true);
    const second = await pull(t.db, scope, { since: first.nextSeq, limit: 10 });
    const ids = [...first.changes, ...second.changes].filter(c => c.entity === 'expenses').map(c => (c.row as { description: string }).description);
    expect(ids).toEqual(['Страница 0', 'Страница 1', 'Страница 2']);
  });

  it('отзыв доступа: объект выпадает из scope, удаление строки доступа приходит как delete', async () => {
    const u = await createUser(t.db, W.a.id, 'foreman');
    await grant(t.db, u.id, W.p1.id, 'edit');
    const before = await resolveScope(t.db, u, null);
    const { snapshotSeq } = await snapshot(t.db, before, { entity: 'projects' });
    await run(W.director, 'access.remove', { userId: u.id, projectId: W.p1.id });
    const after = await resolveScope(t.db, u, null);
    const r = await pull(t.db, after, { since: snapshotSeq });
    expect(r.scope).toEqual([]);
    expect(r.changes).toEqual([expect.objectContaining({ entity: 'project_access', op: 'delete', row: null })]);
  });

  it('клиент отстал дольше срока хранения журнала → 410, нужна повторная загрузка', async () => {
    const scope = await resolveScope(t.db, W.foreman, null);
    await run(W.director, 'budgets.create', { projectId: W.p1.id, category: 'Работы', amount: '1.00' });
    await t.db.execute(sql`update change_log set changed_at = now() - interval '91 days' where organization_id = ${W.a.id}`);
    const hub = new ChangeHub({ connectionString: t.url, db: t.db, log: () => {} });
    await hub.prune();
    await expect(pull(t.db, scope, { since: 1 })).rejects.toMatchObject({ status: 410 });
    const fresh = await snapshot(t.db, scope, { entity: 'projects' });
    await expect(pull(t.db, scope, { since: fresh.snapshotSeq })).resolves.toMatchObject({ hasMore: false });
  });
});
