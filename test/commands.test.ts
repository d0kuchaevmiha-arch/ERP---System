import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { approvals, auditLogs, expenses, tasks } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

const run = <R = Record<string, unknown>>(actor: Actor, name: string, input: unknown) =>
  runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<R>;
type Row = Record<string, unknown> & { id: string };

// Поведение команд, перенесённых из route.ts: сквозной сценарий smoke.ts на уровне доменного слоя.
describe('команды: сквозной сценарий директора', () => {
  it('объект → бюджет → работа → заявка → согласование → приёмка → списание → прогресс → расход', async () => {
    const org = await createOrg(t.db);
    const director = await createUser(t.db, org.id, 'director');
    const project = await run<Row>(director, 'projects.create', { name: 'Объект', code: 'T-1', forecast: '10000.00' });
    await run(director, 'budgets.create', { projectId: project.id, category: 'Материалы', amount: '10000.00' });
    const task = await run<Row>(director, 'tasks.create', { projectId: project.id, name: 'Монтаж', kind: 'work' });
    const material = await run<Row>(director, 'materials.create', { sku: 'T-1', name: 'Арматура', unit: 'кг', price: '100.00', minStock: 2 });
    const warehouse = await run<Row>(director, 'warehouses.create', { name: 'Склад', projectId: project.id });
    const supplier = await run<Row>(director, 'counterparties.create', { name: 'Поставщик', kind: 'supplier' });
    const purchase = await run<Row>(director, 'purchases.create', { projectId: project.id, materialId: material.id, warehouseId: warehouse.id, supplierId: supplier.id, quantity: 10, unitPrice: '100.00' });
    expect(purchase.status).toBe('requested');
    const [pending] = await t.db.select().from(approvals).where(eq(approvals.entityId, purchase.id));
    expect(pending.status).toBe('pending');

    expect((await run<Row>(director, 'approvals.decide', { purchaseId: purchase.id, decision: 'approve' })).status).toBe('ordered');
    await expect(run(director, 'approvals.decide', { purchaseId: purchase.id, decision: 'approve' })).rejects.toThrow(/уже решена: согласована/);

    await run(director, 'purchases.receive', { purchaseId: purchase.id, warehouseId: warehouse.id, quantity: 10 });
    await expect(run(director, 'purchases.receive', { purchaseId: purchase.id, quantity: 1 })).rejects.toThrow(/согласованный заказ/);

    await run(director, 'movements.create', { materialId: material.id, warehouseId: warehouse.id, projectId: project.id, taskId: task.id, type: 'issue', quantity: 3 });
    const issued = await t.db.select().from(expenses).where(eq(expenses.projectId, project.id));
    expect(issued.map(e => e.amount)).toEqual(['300.00']);
    await expect(run(director, 'movements.create', { materialId: material.id, warehouseId: warehouse.id, projectId: project.id, type: 'issue', quantity: 100 })).rejects.toThrow(/доступно только 7\.000/);

    const progressed = await run<Row>(director, 'progress.set', { taskId: task.id, progress: 75, actualQuantity: 3 });
    expect(progressed).toMatchObject({ progress: 75, actualQuantity: '3.000', status: 'active' });

    const expense = await run<Row>(director, 'expenses.create', { projectId: project.id, category: 'Работы', description: 'Монтажные работы', amount: '250.00' });
    expect(expense.budgetWarning).toBe(false);

    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.organizationId, org.id));
    expect(log.some(r => r.entityId === project.id && r.action === 'create')).toBe(true);
    expect(log.every(r => r.actorId === director.id)).toBe(true);
    const [done] = await t.db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(done.progress).toBe(75);
  });
});

describe('команды: общие проверки', () => {
  it('read_only не пишет; неизвестная операция; невалидный ввод → 422', async () => {
    const org = await createOrg(t.db);
    const viewer = await createUser(t.db, org.id, 'read_only');
    const director = await createUser(t.db, org.id, 'director');
    await expect(run(viewer, 'projects.create', { name: 'Объект', code: 'X-1' })).rejects.toMatchObject({ status: 403 });
    await expect(run(director, 'nope.create', {})).rejects.toMatchObject({ status: 404 });
    await expect(run(director, 'budgets.create', { projectId: 'не-uuid', category: 'М', amount: '-1' })).rejects.toMatchObject({ status: 422 });
  });

  it('согласование — только director/super_admin/project_manager/procurement_manager', async () => {
    const org = await createOrg(t.db);
    const foreman = await createUser(t.db, org.id, 'foreman');
    await expect(run(foreman, 'approvals.decide', { purchaseId: crypto.randomUUID(), decision: 'approve' })).rejects.toMatchObject({ status: 403 });
  });

  it('роль без доступа к объекту не пишет в него, с view — тоже, с edit — пишет', async () => {
    const org = await createOrg(t.db);
    const project = await createProject(t.db, org.id);
    const pm = await createUser(t.db, org.id, 'project_manager');
    const input = { projectId: project.id, category: 'Работы', amount: '10.00' };
    await expect(run(pm, 'budgets.create', input)).rejects.toThrow(/Недостаточно прав на этот объект/);
    await grant(t.db, pm.id, project.id, 'view');
    await expect(run(pm, 'budgets.create', input)).rejects.toThrow(/Недостаточно прав на этот объект/);
    const other = await createUser(t.db, org.id, 'project_manager');
    await grant(t.db, other.id, project.id, 'edit');
    await expect(run(other, 'budgets.create', input)).resolves.toMatchObject({ projectId: project.id });
  });

  it('ошибка в середине команды откатывает всю транзакцию', async () => {
    const org = await createOrg(t.db);
    const director = await createUser(t.db, org.id, 'director');
    const project = await createProject(t.db, org.id);
    await expect(run(director, 'purchases.create', { projectId: project.id, materialId: crypto.randomUUID(), quantity: 1, unitPrice: '1.00' })).rejects.toThrow(/Материал не найден/);
    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.organizationId, org.id));
    expect(log).toEqual([]);
  });
});
