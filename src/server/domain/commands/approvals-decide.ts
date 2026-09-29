import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { approvals, purchases } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { DECIDE_ROLES, orgPurchase, requireProjectWrite } from '../authz';
import { businessRule } from '../errors';
import { uuid } from '../schemas';

export default defineCommand({
  name: 'approvals.decide', offline: 'online_only', roles: DECIDE_ROLES,
  schema: z.object({ purchaseId: uuid, decision: z.enum(['approve', 'reject', 'return']), comment: z.string().optional() }),
  async authorize(tx, ctx, input) {
    const p = await orgPurchase(tx, ctx.actor, input.purchaseId);
    await requireProjectWrite(tx, ctx.actor, p.projectId);
    return p;
  },
  async execute(tx, ctx, input, p) {
    const [a] = await tx.select().from(approvals).where(and(eq(approvals.entityId, p.id), eq(approvals.status, 'pending')));
    if (!a) throw businessRule('Нет ожидающего согласования');
    const status = input.decision === 'approve' ? 'ordered' : input.decision === 'reject' ? 'rejected' : 'requested';
    const [row] = await tx.update(purchases).set({ status }).where(eq(purchases.id, p.id)).returning();
    await tx.update(approvals).set({ status: input.decision === 'approve' ? 'approved' : input.decision, comment: input.comment, decidedBy: ctx.actor.id, decidedAt: new Date() }).where(eq(approvals.id, a.id));
    await audit(tx, ctx, input.decision, 'purchase', row.id, p, row);
    return row;
  },
});
