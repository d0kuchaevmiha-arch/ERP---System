import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { expenses, materials, notifications, stockMovements, warehouses } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES, requireProjectWrite } from '../authz';
import { businessRule } from '../errors';
import { costOf } from '../money';
import { quantity, uuid } from '../schemas';

export default defineCommand({
  name: 'movements.create', offline: 'conflictable', roles: WRITE_ROLES,
  schema: z.object({ materialId: uuid, warehouseId: uuid, projectId: uuid.optional(), taskId: uuid.optional(), quantity, type: z.enum(['receipt', 'issue', 'return', 'writeoff']), note: z.string().optional() }),
  async authorize(tx, ctx, input) {
    if (input.projectId) await requireProjectWrite(tx, ctx.actor, input.projectId);
    const [m] = await tx.select().from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, ctx.actor.organizationId)));
    const [w] = await tx.select().from(warehouses).where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.organizationId, ctx.actor.organizationId)));
    if (!m || !w) throw businessRule('Материал или склад не найден');
    return { m, w };
  },
  async execute(tx, ctx, input, { m, w }) {
    // Остаток проверяется под блокировкой пары материал+склад: параллельные списания идут по очереди.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.materialId + input.warehouseId}))`);
    const [balance] = await tx.select({ total: sql<string>`coalesce(sum(case when ${stockMovements.type} in ('receipt','return','transfer_in') then ${stockMovements.quantity} else -${stockMovements.quantity} end),0)` }).from(stockMovements).where(and(eq(stockMovements.materialId, input.materialId), eq(stockMovements.warehouseId, input.warehouseId)));
    const outgoing = input.type === 'issue' || input.type === 'writeoff';
    if (outgoing && Number(balance.total) < input.quantity) throw businessRule(`Невозможно списать ${input.quantity} ${m.unit} материала «${m.name}»: доступно только ${balance.total} ${m.unit}.`);
    const [row] = await tx.insert(stockMovements).values({ materialId: input.materialId, warehouseId: input.warehouseId, projectId: input.projectId || w.projectId, taskId: input.taskId || null, type: input.type, quantity: String(input.quantity), note: input.note }).returning();
    await audit(tx, ctx, input.type, 'stock_movement', row.id, null, row);
    if (outgoing && w.projectId) {
      await tx.insert(expenses).values({ projectId: input.projectId || w.projectId, taskId: input.taskId || null, category: 'Материалы', description: `Списание: ${m.name} · ${input.quantity} ${m.unit}`, amount: costOf(input.quantity, m.price), incurredAt: new Date().toISOString().slice(0, 10) });
    }
    if (Number(balance.total) + (outgoing ? -input.quantity : input.quantity) < Number(m.minStock)) await tx.insert(notifications).values({ userId: ctx.actor.id, title: 'Низкий остаток материала', body: m.name, href: '/warehouse' });
    return row;
  },
});
