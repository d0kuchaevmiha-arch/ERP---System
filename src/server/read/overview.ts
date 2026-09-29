import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { projects, projectAccess, tasks, budgetLines, expenses, materials, warehouses, stockMovements, purchases, counterparties, contracts, notifications, users, auditLogs } from '@/db/schema';
import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';
import { isOrgWide } from '@/server/domain/authz';

// Роли, которым видны договоры без привязки к объекту (Допущение, §14).
const ORG_CONTRACT_ROLES = ['director', 'super_admin', 'finance_manager', 'accountant'];

// Объекты, доступные пользователю: вся организация для director/super_admin, иначе — по project_access (view или edit).
export async function visibleProjectIds(db: Db, user: SessionUser) {
  const rows = isOrgWide(user)
    ? await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, user.organizationId))
    : await db.select({ id: projects.id }).from(projects).innerJoin(projectAccess, eq(projectAccess.projectId, projects.id))
      .where(and(eq(projects.organizationId, user.organizationId), eq(projectAccess.userId, user.id)));
  return rows.map(r => r.id);
}

// Сводка только в пределах организации пользователя и его объектов (§5.2.1). Без пользователя данных нет.
export async function getOverviewFor(db: Db, user: SessionUser) {
  const org = user.organizationId;
  const ids = await visibleProjectIds(db, user);
  // inArray с пустым списком — «ничего»; явное условие понятнее.
  const inProjects = (col: Parameters<typeof inArray>[0]): SQL => (ids.length ? inArray(col, ids) : eq(col, '00000000-0000-0000-0000-000000000000'));
  const orgWarehouses = db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.organizationId, org));

  const [ps, ts, bs, es, ms, ws, allMoves, buys, parties, cs, ns, people, logs] = await Promise.all([
    db.select().from(projects).where(and(eq(projects.organizationId, org), inProjects(projects.id))).orderBy(desc(projects.createdAt)),
    db.select().from(tasks).where(inProjects(tasks.projectId)),
    db.select().from(budgetLines).where(inProjects(budgetLines.projectId)),
    db.select().from(expenses).where(inProjects(expenses.projectId)).orderBy(desc(expenses.incurredAt)),
    db.select().from(materials).where(eq(materials.organizationId, org)),
    db.select().from(warehouses).where(eq(warehouses.organizationId, org)),
    // Все движения складов организации: остатки считаются полностью (Допущение), а список — только по доступным объектам.
    db.select().from(stockMovements).where(inArray(stockMovements.warehouseId, orgWarehouses)).orderBy(desc(stockMovements.createdAt)),
    db.select().from(purchases).where(and(eq(purchases.organizationId, org), inProjects(purchases.projectId))).orderBy(desc(purchases.createdAt)),
    db.select().from(counterparties).where(eq(counterparties.organizationId, org)),
    db.select().from(contracts).where(and(eq(contracts.organizationId, org), ORG_CONTRACT_ROLES.includes(user.role) ? or(isNull(contracts.projectId), inProjects(contracts.projectId)) : inProjects(contracts.projectId))),
    db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)),
    db.select({ id: users.id, name: users.name, role: users.role, organizationId: users.organizationId }).from(users).where(eq(users.organizationId, org)),
    db.select().from(auditLogs).where(isOrgWide(user) ? eq(auditLogs.organizationId, org) : and(eq(auditLogs.organizationId, org), eq(auditLogs.actorId, user.id))).orderBy(desc(auditLogs.createdAt)).limit(40),
  ]);
  const visible = new Set(ids);
  const moves = allMoves.filter(m => !m.projectId || visible.has(m.projectId));

  const today = new Date().toISOString().slice(0,10);
  const projectRows = ps.map(p => {
    const budget = bs.filter(b => b.projectId === p.id).reduce((n,b) => n + Number(b.amount), 0);
    const actual = es.filter(e => e.projectId === p.id).reduce((n,e) => n + Number(e.amount), 0);
    const forecast = Number(p.forecast) || Math.max(actual, budget);
    return { ...p, budget, actual, forecast, variance: budget - forecast, manager: people.find(u => u.id === p.managerId)?.name || 'Не назначен', customer: parties.find(c => c.id === p.customerId)?.name || '—', delayedTasks: ts.filter(t => t.projectId === p.id && t.endDate && t.endDate < today && t.progress < 100).length };
  });
  const materialRows = ms.map(m => {
    const balance = allMoves.filter(x => x.materialId === m.id).reduce((n,x) => n + (['receipt','return','transfer_in'].includes(x.type) ? Number(x.quantity) : -Number(x.quantity)), 0);
    return { ...m, balance, shortage: balance < Number(m.minStock) };
  });
  const purchaseRows = buys.map(b => ({ ...b, project: ps.find(p => p.id === b.projectId)?.name || '—', material: ms.find(m => m.id === b.materialId)?.name || '—', supplier: parties.find(c => c.id === b.supplierId)?.name || '—', delayed: Boolean(b.dueAt && b.dueAt < today && Number(b.receivedQuantity) < Number(b.quantity)) }));
  const taskRows = ts.map(t => ({ ...t, project: ps.find(p => p.id === t.projectId)?.name || '—', delayed: Boolean(t.endDate && t.endDate < today && t.progress < 100) }));
  return { projects: projectRows, tasks: taskRows, budgets: bs, expenses: es.map(e => ({...e, project: ps.find(p => p.id === e.projectId)?.name || '—'})), materials: materialRows, warehouses: ws, movements: moves, purchases: purchaseRows, counterparties: parties, contracts: cs, notifications: ns, people, audit: logs,
    metrics: { budget: projectRows.reduce((n,p) => n+p.budget,0), actual: projectRows.reduce((n,p) => n+p.actual,0), forecast: projectRows.reduce((n,p) => n+p.forecast,0), contractValue: projectRows.reduce((n,p) => n+Number(p.contractValue),0), active: projectRows.filter(p => p.status !== 'completed').length, delayedTasks: taskRows.filter(t => t.delayed).length, delayedPurchases: purchaseRows.filter(p => p.delayed).length, shortages: materialRows.filter(m => m.shortage).length, openRequests: purchaseRows.filter(p => p.status === 'requested').length } };
}
export type Overview = Awaited<ReturnType<typeof getOverviewFor>>;
