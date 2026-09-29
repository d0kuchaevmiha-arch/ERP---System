import { db } from '@/db';
import { projects, tasks, budgetLines, expenses, materials, warehouses, stockMovements, purchases, counterparties, contracts, notifications, users, auditLogs } from '@/db/schema';
import { desc } from 'drizzle-orm';

export async function getOverview() {
  const [ps, ts, bs, es, ms, ws, moves, buys, parties, cs, ns, people, logs] = await Promise.all([
    db.select().from(projects).orderBy(desc(projects.createdAt)), db.select().from(tasks), db.select().from(budgetLines), db.select().from(expenses).orderBy(desc(expenses.incurredAt)), db.select().from(materials), db.select().from(warehouses), db.select().from(stockMovements).orderBy(desc(stockMovements.createdAt)), db.select().from(purchases).orderBy(desc(purchases.createdAt)), db.select().from(counterparties), db.select().from(contracts), db.select().from(notifications).orderBy(desc(notifications.createdAt)), db.select({id: users.id, name: users.name, role: users.role, organizationId: users.organizationId}).from(users), db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(40)
  ]);
  const today = new Date().toISOString().slice(0,10);
  const projectRows = ps.map(p => {
    const budget = bs.filter(b => b.projectId === p.id).reduce((n,b) => n + Number(b.amount), 0);
    const actual = es.filter(e => e.projectId === p.id).reduce((n,e) => n + Number(e.amount), 0);
    const forecast = Number(p.forecast) || Math.max(actual, budget);
    return { ...p, budget, actual, forecast, variance: budget - forecast, manager: people.find(u => u.id === p.managerId)?.name || 'Не назначен', customer: parties.find(c => c.id === p.customerId)?.name || '—', delayedTasks: ts.filter(t => t.projectId === p.id && t.endDate && t.endDate < today && t.progress < 100).length };
  });
  const materialRows = ms.map(m => {
    const balance = moves.filter(x => x.materialId === m.id).reduce((n,x) => n + (['receipt','return','transfer_in'].includes(x.type) ? Number(x.quantity) : -Number(x.quantity)), 0);
    return { ...m, balance, shortage: balance < Number(m.minStock) };
  });
  const purchaseRows = buys.map(b => ({ ...b, project: ps.find(p => p.id === b.projectId)?.name || '—', material: ms.find(m => m.id === b.materialId)?.name || '—', supplier: parties.find(c => c.id === b.supplierId)?.name || '—', delayed: Boolean(b.dueAt && b.dueAt < today && Number(b.receivedQuantity) < Number(b.quantity)) }));
  const taskRows = ts.map(t => ({ ...t, project: ps.find(p => p.id === t.projectId)?.name || '—', delayed: Boolean(t.endDate && t.endDate < today && t.progress < 100) }));
  return { projects: projectRows, tasks: taskRows, budgets: bs, expenses: es.map(e => ({...e, project: ps.find(p => p.id === e.projectId)?.name || '—'})), materials: materialRows, warehouses: ws, movements: moves, purchases: purchaseRows, counterparties: parties, contracts: cs, notifications: ns, people, audit: logs,
    metrics: { budget: projectRows.reduce((n,p) => n+p.budget,0), actual: projectRows.reduce((n,p) => n+p.actual,0), forecast: projectRows.reduce((n,p) => n+p.forecast,0), contractValue: projectRows.reduce((n,p) => n+Number(p.contractValue),0), active: projectRows.filter(p => p.status !== 'completed').length, delayedTasks: taskRows.filter(t => t.delayed).length, delayedPurchases: purchaseRows.filter(p => p.delayed).length, shortages: materialRows.filter(m => m.shortage).length, openRequests: purchaseRows.filter(p => p.status === 'requested').length } };
}
export type Overview = Awaited<ReturnType<typeof getOverview>>;
