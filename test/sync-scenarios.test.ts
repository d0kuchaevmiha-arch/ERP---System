import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as s from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { listConflicts } from '@/server/read/conflicts';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';
import { EmulatedClient } from './helpers/sync-client';

// Сценарные sync-тесты P4 (§11, §12): два эмулированных клиента против настоящей серверной БД.
// Офлайн-ввод → восстановление связи → результат на сервере и на каждом ноутбуке.

let server: TestDb;
const clients: EmulatedClient[] = [];
beforeAll(async () => { server = await createMigratedDb(); });
afterAll(async () => { for (const c of clients) await c.drop(); await server?.drop(); });

const run = <T = { id: string }>(actor: Actor, name: string, input: unknown) => runCommand({ db: server.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<T>;
const client = async (u: Actor) => { const c = await EmulatedClient.create(server, u); clients.push(c); expect(await c.sync()).toBe(true); return c; };

async function balance(materialId: string, warehouseId: string) {
  const { rows: [r] } = await server.db.execute<{ total: string }>(sql`select coalesce(sum(case when type in ('receipt','return','transfer_in') then quantity else -quantity end),0)::text as total from stock_movements where material_id = ${materialId} and warehouse_id = ${warehouseId}`);
  return Number(r.total);
}
const serverRow = async (table: typeof s.expenses | typeof s.stockMovements | typeof s.purchases | typeof s.taskProgressLog, id: string) =>
  (await server.db.select().from(table).where(eq(table.id, id)))[0];

// Организация: объект с работой и складом, материал с остатком 10, согласованная заявка на 5.
async function world() {
  const org = await createOrg(server.db);
  const director = await createUser(server.db, org.id, 'director');
  const pm = await createUser(server.db, org.id, 'project_manager');
  const foreman = await createUser(server.db, org.id, 'foreman');
  const keeper = await createUser(server.db, org.id, 'warehouse_manager');
  const p1 = await createProject(server.db, org.id);
  for (const u of [pm, foreman, keeper]) await grant(server.db, u.id, p1.id, 'edit');
  const [task] = await server.db.insert(s.tasks).values({ projectId: p1.id, name: 'Кладка', unit: 'м3' }).returning();
  const [w1] = await server.db.insert(s.warehouses).values({ organizationId: org.id, projectId: p1.id, name: 'Склад объекта' }).returning();
  const [m1] = await server.db.insert(s.materials).values({ organizationId: org.id, sku: `M-${crypto.randomUUID().slice(0, 6)}`, name: 'Цемент', unit: 'меш', price: '450.00' }).returning();
  const [m2] = await server.db.insert(s.materials).values({ organizationId: org.id, sku: `M-${crypto.randomUUID().slice(0, 6)}`, name: 'Арматура', unit: 'т', price: '70000.00' }).returning();
  await run(keeper, 'movements.create', { materialId: m1.id, warehouseId: w1.id, quantity: 10, type: 'receipt' });
  const orderedPurchase = async (quantity = 5) => {
    const p = await run(pm, 'purchases.create', { projectId: p1.id, materialId: m2.id, warehouseId: w1.id, quantity, unitPrice: '70000.00' });
    await run(director, 'approvals.decide', { purchaseId: p.id, decision: 'approve' });
    return p;
  };
  return { org, director, pm, foreman, keeper, p1, task, w1, m1, m2, orderedPurchase };
}

describe('P4: офлайн-ввод и синхронизация (§11)', () => {
  it('оба клиента офлайн списывают последние 10 ед. → 1 applied + 1 conflict; остаток не уходит в минус', async () => {
    const w = await world();
    const a = await client(w.foreman); const b = await client(w.keeper);
    a.online = false; b.online = false;
    const issue = { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 10, type: 'issue' };
    const wa = await a.write('movements.create', issue);
    const wb = await b.write('movements.create', issue);
    // На ноутбуке запись видна сразу, с пометкой «не синхронизировано».
    expect(await a.ids('stock_movements')).toContain(wa.id);
    expect((await a.marks()).pending).toContain(wa.id);

    a.online = true; expect(await a.sync()).toBe(true);
    b.online = true; expect(await b.sync()).toBe(true);

    const [oa] = await a.outbox(); const [ob] = await b.outbox();
    expect(oa.status).toBe('applied');
    expect(ob.status).toBe('conflict');
    expect(ob.conflictId).toBeTruthy();
    expect(await balance(w.m1.id, w.w1.id)).toBe(0);
    // Спорная операция на сервере не проведена, но и не потеряна: она в «Требует решения».
    expect(await serverRow(s.stockMovements, wb.id!)).toBeUndefined();
    const forPm = await listConflicts(server.db, w.pm);
    expect(forPm.map(c => c.id)).toContain(ob.conflictId);
    expect(forPm.find(c => c.id === ob.conflictId)).toMatchObject({ kind: 'insufficient_stock', status: 'open', authorId: w.keeper.id });
    // У второго клиента строка остаётся и помечена «спорно»; первый видит свою строку уже серверной.
    expect((await b.marks()).conflict).toContain(wb.id);
    expect((await a.marks()).pending).not.toContain(wa.id);
    const { rows } = await b.local.db.execute<{ id: string; status: string }>(sql`select id, status from sync_conflicts`);
    expect(rows).toEqual([{ id: ob.conflictId, status: 'open' }]);
  });

  it('отклонённая операция откатывается локально и видна с причиной', async () => {
    const w = await world();
    const a = await client(w.foreman);
    a.online = false;
    const e = await a.write('expenses.create', { projectId: w.p1.id, category: 'Прочее', description: 'Такси для бригады', amount: '1500.00' });
    expect(await a.ids('expenses')).toContain(e.id);
    // Пока прораб был без связи, ему оставили только просмотр объекта.
    await run(w.director, 'access.set', { userId: w.foreman.id, projectId: w.p1.id, permission: 'view' });

    a.online = true; expect(await a.sync()).toBe(true);
    const [op] = await a.outbox();
    expect(op).toMatchObject({ status: 'rejected', errorCode: 'no_access' });
    expect(op.error).toBeTruthy();
    expect(await a.ids('expenses')).not.toContain(e.id);
    expect(await serverRow(s.expenses, e.id!)).toBeUndefined();
    expect(await a.ids('projects')).toContain(w.p1.id);
  });

  it('отзыв доступа удаляет объект с клиента вместе с его неотправленными строками', async () => {
    const w = await world();
    const a = await client(w.foreman);
    a.online = false;
    const p = await a.write('progress.set', { taskId: w.task.id, progress: 40 });
    await run(w.director, 'access.remove', { userId: w.foreman.id, projectId: w.p1.id });

    a.online = true; expect(await a.sync()).toBe(true);
    expect(await a.ids('projects')).not.toContain(w.p1.id);
    expect(await a.ids('tasks')).not.toContain(w.task.id);
    expect(await a.ids('task_progress_log')).not.toContain(p.id);
    const [op] = await a.outbox();
    expect(op).toMatchObject({ status: 'rejected', errorCode: 'no_access' });
  });

  it('все allowed/conflictable команды вводятся без сети и после связи синхронизируются', async () => {
    const w = await world();
    const purchase = await w.orderedPurchase(5);
    const c = await client(w.pm);
    c.online = false;
    const written = [
      await c.write('progress.set', { taskId: w.task.id, progress: 55, actualQuantity: 12.5 }),
      await c.write('expenses.create', { projectId: w.p1.id, category: 'Прочее', description: 'Пропуск на объект', amount: '350.50' }),
      await c.write('purchases.create', { projectId: w.p1.id, materialId: w.m1.id, warehouseId: w.w1.id, quantity: 20, unitPrice: '450.00' }),
      await c.write('movements.create', { materialId: w.m2.id, warehouseId: w.w1.id, quantity: 4, type: 'receipt' }),
      await c.write('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 3, type: 'issue', taskId: w.task.id }),
      await c.write('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 1, type: 'return' }),
      await c.write('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 1, type: 'writeoff' }),
      await c.write('purchases.receive', { purchaseId: purchase.id, quantity: 5 }),
    ];
    expect((await c.marks()).pending.length).toBeGreaterThanOrEqual(written.length);
    // Временный номер заявки виден сразу.
    const localPurchase = await c.row<{ number: string; localRef: string }>('purchases', written[2].id!);
    expect(localPurchase?.localRef).toBeTruthy();

    c.online = true; expect(await c.sync()).toBe(true);
    const ops = await c.outbox();
    expect(ops.map(o => o.status)).toEqual(written.map(() => 'applied'));
    expect((await c.marks()).pending).toEqual([]);

    // На сервере — те же id, происхождение «офлайн» с устройства и временем ввода.
    for (const [table, id] of [[s.taskProgressLog, written[0].id], [s.expenses, written[1].id], [s.purchases, written[2].id], [s.stockMovements, written[3].id], [s.stockMovements, written[7].id]] as const) {
      const row = await serverRow(table, id!);
      expect(row).toMatchObject({ origin: 'offline', deviceId: c.deviceId });
      expect(row.deviceCreatedAt!.getTime()).toBeLessThanOrEqual(row.serverReceivedAt.getTime());
    }
    expect(await balance(w.m1.id, w.w1.id)).toBe(10 - 3 + 1 - 1);
    expect(await balance(w.m2.id, w.w1.id)).toBe(4 + 5);
    const [task] = await server.db.select().from(s.tasks).where(eq(s.tasks.id, w.task.id));
    expect(task).toMatchObject({ progress: 55, actualQuantity: '12.500' });
    const [p] = await server.db.select().from(s.purchases).where(eq(s.purchases.id, purchase.id));
    expect(p).toMatchObject({ status: 'received', receivedQuantity: '5.000' });

    // Реплика после pull совпадает с сервером: серверный номер заявки, автоматический расход на списание.
    const replicaPurchase = await c.row<{ number: string }>('purchases', written[2].id!);
    const [srvPurchase] = await server.db.select().from(s.purchases).where(eq(s.purchases.id, written[2].id!));
    expect(replicaPurchase?.number).toBe(srvPurchase.number);
    expect(srvPurchase.number).toMatch(/^ЗК-/);
    const serverExpenses = (await server.db.select({ id: s.expenses.id }).from(s.expenses).where(eq(s.expenses.projectId, w.p1.id))).map(r => r.id).sort();
    expect((await c.ids('expenses')).sort()).toEqual(serverExpenses);
    expect(await c.row<{ progress: number }>('tasks', w.task.id)).toMatchObject({ progress: 55 });
  });

  it('повтор пакета после обрыва связи не создаёт дублей', async () => {
    const w = await world();
    const c = await client(w.foreman);
    c.online = false;
    const e1 = await c.write('expenses.create', { projectId: w.p1.id, category: 'Прочее', description: 'Вода', amount: '200.00' });
    const e2 = await c.write('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 2, type: 'issue' });
    c.online = true; c.dropNextPushResponse = true;
    expect(await c.sync()).toBe(false);
    expect((await c.outbox()).map(o => o.status)).toEqual(['pending', 'pending']);
    expect(await c.sync()).toBe(true);
    expect((await c.outbox()).map(o => o.status)).toEqual(['applied', 'applied']);
    const opIds = (await c.outbox()).map(o => o.opId);
    const count = async (table: typeof s.expenses | typeof s.stockMovements) =>
      (await server.db.select({ id: table.id }).from(table).where(inArray(table.opId, opIds))).length;
    expect(await count(s.expenses)).toBe(2); // расход вручную + автоматический расход на списание
    expect(await count(s.stockMovements)).toBe(1);
    expect(await serverRow(s.expenses, e1.id!)).toBeTruthy();
    expect(await balance(w.m1.id, w.w1.id)).toBe(8);
    expect(e2.id).toBeTruthy();
  });

  it('более ранний офлайн-факт прогресса не перетирает более свежий онлайн-факт', async () => {
    const w = await world();
    const c = await client(w.foreman);
    c.online = false;
    const offlineFact = await c.write('progress.set', { taskId: w.task.id, progress: 30 });
    await new Promise(r => setTimeout(r, 20));
    await run(w.pm, 'progress.set', { taskId: w.task.id, progress: 60 });
    c.online = true; expect(await c.sync()).toBe(true);
    expect((await c.outbox())[0].status).toBe('applied');
    const [task] = await server.db.select().from(s.tasks).where(eq(s.tasks.id, w.task.id));
    expect(task.progress).toBe(60);
    expect(await serverRow(s.taskProgressLog, offlineFact.id!)).toMatchObject({ progress: 30, applied: false });
    expect(await c.row<{ progress: number }>('tasks', w.task.id)).toMatchObject({ progress: 60 });
  });

  it('операция, зависящая от отклонённой, отклоняется как dependency_rejected', async () => {
    const w = await world();
    const c = await client(w.foreman);
    c.online = false;
    const receipt = await c.write('movements.create', { materialId: w.m2.id, warehouseId: w.w1.id, quantity: 5, type: 'receipt' });
    const issue = await c.write('movements.create', { materialId: w.m2.id, warehouseId: w.w1.id, quantity: 5, type: 'issue' });
    // Эмулируем отказ сервера по приходу: материал в операции не существует на сервере.
    await c.local.db.execute(sql`update outbox set payload = jsonb_set(payload, '{materialId}', to_jsonb(${crypto.randomUUID()}::text)) where op_id = ${receipt.opId}`);
    c.online = true; expect(await c.sync()).toBe(true);
    const [r, i] = await c.outbox();
    expect(r.status).toBe('rejected');
    expect(i).toMatchObject({ status: 'rejected', errorCode: 'dependency_rejected' });
    expect(await c.ids('stock_movements')).not.toContain(issue.id);
    expect(await c.ids('stock_movements')).not.toContain(receipt.id);
    expect(await sqlCount(sql`select count(*) from sync_conflicts where op_id = ${issue.opId}`)).toBe(0);
  });

  it('online_only-команда без связи недоступна и не попадает в очередь', async () => {
    const w = await world();
    const c = await client(w.pm);
    c.online = false;
    await expect(c.write('budgets.create', { projectId: w.p1.id, category: 'Материалы', amount: '1000.00' })).rejects.toMatchObject({ code: 'online_only' });
    await expect(c.write('approvals.decide', { purchaseId: crypto.randomUUID(), decision: 'approve' })).rejects.toMatchObject({ code: 'online_only' });
    expect(await c.outbox()).toEqual([]);
  });

  it('приёмка сверх заказа → конфликт; РП проводит с исправлением или отклоняет', async () => {
    const w = await world();
    const c = await client(w.pm);
    const p1 = await w.orderedPurchase(5);
    const p2 = await w.orderedPurchase(5);
    expect(await c.sync()).toBe(true);
    c.online = false;
    const r1 = await c.write('purchases.receive', { purchaseId: p1.id, quantity: 5 });
    const r2 = await c.write('purchases.receive', { purchaseId: p2.id, quantity: 5 });
    // Пока РП был без связи, по обеим заявкам часть уже приняли онлайн.
    await run(w.director, 'purchases.receive', { purchaseId: p1.id, quantity: 3 });
    await run(w.director, 'purchases.receive', { purchaseId: p2.id, quantity: 4 });
    c.online = true; expect(await c.sync()).toBe(true);
    const [o1, o2] = await c.outbox();
    expect(o1.status).toBe('conflict'); expect(o2.status).toBe('conflict');
    const conflicts = await listConflicts(server.db, w.pm);
    expect(conflicts.find(x => x.id === o1.conflictId)).toMatchObject({ kind: 'over_receipt', status: 'open' });

    // Исправление: принять только остаток 2. Строка получает тот же id, что на ноутбуке.
    await run(w.pm, 'conflicts.resolve', { conflictId: o1.conflictId, quantity: 2 });
    // Двойной разбор — понятный отказ.
    await expect(run(w.director, 'conflicts.resolve', { conflictId: o1.conflictId, quantity: 2 })).rejects.toMatchObject({ status: 409 });
    await run(w.pm, 'conflicts.discard', { conflictId: o2.conflictId, comment: 'Поставка по накладной уже принята' });

    expect(await c.sync()).toBe(true);
    const [n1, n2] = await c.outbox();
    expect(n1.status).toBe('applied');
    expect(n2).toMatchObject({ status: 'rejected', errorCode: 'conflict_discarded' });
    expect(n2.error).toContain('Поставка по накладной уже принята');
    expect(await serverRow(s.stockMovements, r1.id!)).toMatchObject({ quantity: '2.000', origin: 'offline', deviceId: c.deviceId });
    expect(await c.row('stock_movements', r1.id!)).toMatchObject({ quantity: '2.000' });
    expect(await c.ids('stock_movements')).not.toContain(r2.id);
    expect(await c.row('purchases', p2.id)).toMatchObject({ receivedQuantity: '4.000', status: 'partial' });
    expect(await c.row('purchases', p1.id)).toMatchObject({ receivedQuantity: '5.000', status: 'received' });
    expect((await c.marks()).conflict).toEqual([]);
  });

  it('операции, введённые после блокировки пользователя, отклоняются как user_blocked', async () => {
    const w = await world();
    const c = await client(w.foreman);
    c.online = false;
    const before = await c.write('expenses.create', { projectId: w.p1.id, category: 'Прочее', description: 'До блокировки', amount: '100.00' });
    await new Promise(r => setTimeout(r, 20));
    await run(w.director, 'users.update', { userId: w.foreman.id, isActive: false });
    await new Promise(r => setTimeout(r, 20));
    const after = await c.write('expenses.create', { projectId: w.p1.id, category: 'Прочее', description: 'После блокировки', amount: '100.00' });
    await new Promise(r => setTimeout(r, 20));
    await run(w.director, 'users.update', { userId: w.foreman.id, isActive: true });

    c.online = true; expect(await c.sync()).toBe(true);
    const [o1, o2] = await c.outbox();
    expect(o1.status).toBe('applied');
    expect(o2).toMatchObject({ status: 'rejected', errorCode: 'user_blocked' });
    expect(await serverRow(s.expenses, before.id!)).toBeTruthy();
    expect(await serverRow(s.expenses, after.id!)).toBeUndefined();
  });

  it('повторная загрузка реплики при непустой очереди сохраняет неотправленные строки', async () => {
    const w = await world();
    const c = await client(w.foreman);
    c.online = false;
    const e = await c.write('expenses.create', { projectId: w.p1.id, category: 'Прочее', description: 'Перчатки', amount: '640.00' });
    c.online = true;
    await c.agent.fullSnapshot(await c.agent.state());
    expect(await c.ids('expenses')).toContain(e.id);
    expect((await c.marks()).pending).toContain(e.id);
    expect(await c.sync()).toBe(true);
    expect((await c.outbox())[0].status).toBe('applied');
    expect(await serverRow(s.expenses, e.id!)).toBeTruthy();
  });

  it('порядок ввода сохраняется; предпроверка остатка учитывает операции в очереди', async () => {
    const w = await world();
    const c = await client(w.keeper);
    c.online = false;
    // Остатка 10 не хватает на 11 — отказ сразу, в очередь не попадает.
    await expect(c.write('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 11, type: 'issue' })).rejects.toMatchObject({ code: 'business_rule' });
    expect(await c.outbox()).toEqual([]);
    // Приход офлайн, затем расход из него: локально можно, на сервере — в том же порядке.
    await c.write('movements.create', { materialId: w.m2.id, warehouseId: w.w1.id, quantity: 3, type: 'receipt' });
    await c.write('movements.create', { materialId: w.m2.id, warehouseId: w.w1.id, quantity: 3, type: 'issue' });
    await c.write('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 10, type: 'issue' });
    await expect(c.write('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 1, type: 'issue' })).rejects.toMatchObject({ code: 'business_rule' });
    c.online = true; expect(await c.sync()).toBe(true);
    expect((await c.outbox()).map(o => o.status)).toEqual(['applied', 'applied', 'applied']);
    expect(await balance(w.m2.id, w.w1.id)).toBe(0);
    expect(await balance(w.m1.id, w.w1.id)).toBe(0);
    const srv = await server.db.select().from(s.stockMovements).where(and(eq(s.stockMovements.materialId, w.m2.id), eq(s.stockMovements.origin, 'offline')));
    expect(srv).toHaveLength(2);
  });
});

async function sqlCount(q: ReturnType<typeof sql>) {
  try { const { rows: [r] } = await server.db.execute<{ count: string }>(q); return Number(r.count); } catch { return -1; }
}
