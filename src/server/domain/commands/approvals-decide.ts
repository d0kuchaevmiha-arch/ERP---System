import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { approvals, purchases, users } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { DECIDE_ROLES, orgPurchase, requireProjectWrite } from '../authz';
import { businessRule, conflict } from '../errors';
import { uuid } from '../schemas';

const decided: Record<string, string> = { approved: 'согласована', rejected: 'отклонена', reject: 'отклонена', return: 'возвращена' };

export default defineCommand({
  name: 'approvals.decide', offline: 'online_only', roles: DECIDE_ROLES,
  schema: z.object({ purchaseId: uuid, decision: z.enum(['approve', 'reject', 'return']), comment: z.string().optional() }),
  async authorize(tx, ctx, input) {
    const p = await orgPurchase(tx, ctx.actor, input.purchaseId);
    await requireProjectWrite(tx, ctx.actor, p.projectId);
    return p;
  },
  async execute(tx, ctx, input, p) {
    // Условный UPDATE: из двух одновременных решений строку «pending» получит только одно.
    const [a] = await tx.update(approvals)
      .set({ status: input.decision === 'approve' ? 'approved' : input.decision, comment: input.comment, decidedBy: ctx.actor.id, decidedAt: new Date() })
      .where(and(eq(approvals.entityType, 'purchase'), eq(approvals.entityId, p.id), eq(approvals.status, 'pending')))
      .returning();
    if (!a) {
      const [last] = await tx.select({ status: approvals.status, by: users.name }).from(approvals).leftJoin(users, eq(users.id, approvals.decidedBy))
        .where(and(eq(approvals.entityType, 'purchase'), eq(approvals.entityId, p.id))).orderBy(desc(approvals.decidedAt)).limit(1);
      if (!last) throw businessRule('Нет ожидающего согласования');
      throw conflict(`Заявка уже решена: ${decided[last.status] ?? last.status}${last.by ? ` — ${last.by}` : ''}`);
    }
    const status = input.decision === 'approve' ? 'ordered' : input.decision === 'reject' ? 'rejected' : 'requested';
    const [row] = await tx.update(purchases).set({ status }).where(eq(purchases.id, p.id)).returning();
    await audit(tx, ctx, input.decision, 'purchase', row.id, p, row);
    return row;
  },
});
