import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { budgetLines, expenses, notifications } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES, orgContract, orgCounterparty, requireProjectWrite, requireSameProject, requireTaskOfProject } from '../authz';
import { amount, uuid } from '../schemas';

export default defineCommand({
  name: 'expenses.create', offline: 'allowed', roles: WRITE_ROLES,
  schema: z.object({ projectId: uuid, category: z.string().min(2), description: z.string().min(2), amount, taskId: uuid.optional(), contractId: uuid.optional(), counterpartyId: uuid.optional(), incurredAt: z.string().optional() }),
  async authorize(tx, ctx, input) {
    const project = await requireProjectWrite(tx, ctx.actor, input.projectId);
    await requireTaskOfProject(tx, ctx.actor, input.taskId, project.id);
    if (input.contractId) requireSameProject((await orgContract(tx, ctx.actor, input.contractId)).projectId, project.id, 'Договор');
    if (input.counterpartyId) await orgCounterparty(tx, ctx.actor, input.counterpartyId);
  },
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(expenses).values({ projectId: input.projectId, category: input.category, description: input.description, amount: String(input.amount), taskId: input.taskId || null, contractId: input.contractId || null, counterpartyId: input.counterpartyId || null, incurredAt: input.incurredAt || new Date().toISOString().slice(0, 10) }).returning();
    await audit(tx, ctx, 'create', 'expense', row.id, null, row);
    const [totals] = await tx.select({ total: sql<string>`coalesce(sum(${expenses.amount}),0)` }).from(expenses).where(eq(expenses.projectId, input.projectId));
    const [budget] = await tx.select({ total: sql<string>`coalesce(sum(${budgetLines.amount}),0)` }).from(budgetLines).where(eq(budgetLines.projectId, input.projectId));
    const over = Number(totals.total) > Number(budget.total);
    if (over) await tx.insert(notifications).values({ userId: ctx.actor.id, title: 'Превышен бюджет объекта', body: `Расходы: ${totals.total} ₽; бюджет: ${budget.total} ₽`, href: `/projects/${input.projectId}` });
    return { ...row, budgetWarning: over };
  },
});
