import { z, ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { syncConflicts } from '@/db/schema';
import { defineCommand, type Command } from '../command';
import { audit, changed, type CommandContext } from '../context';
import { RESOLVE_ROLES } from '../authz';
import { forbidden, invalid } from '../errors';
import { openConflict, settleOp } from '../conflicts';
import { quantity, uuid } from '../schemas';
import { bump } from '../versions';
import movementsCreate from './movements-create';
import purchasesReceive from './purchases-receive';

// «Провести с исправлением» (§5.1, решение P4 №6): исходная офлайн-операция с исправленным количеством (и складом
// для списания) выполняется обычной командой — те же проверки остатка и заказа, в минус и сверх заказа нельзя.
// Происхождение (устройство, время ввода, op_id) и id строки — исходные; аудит — от имени разбирающего.
// Пример из жизни: кладовщик не выбрасывает спорную накладную прораба, а проводит её на то количество, что есть.
const inner: Record<string, Command<any, any, unknown>> = { 'movements.create': movementsCreate, 'purchases.receive': purchasesReceive };

export default defineCommand({
  name: 'conflicts.resolve', offline: 'online_only', roles: RESOLVE_ROLES, deniedMessage: 'Разбирать конфликты может кладовщик, РП, снабженец или директор',
  schema: z.object({ conflictId: uuid, quantity, warehouseId: uuid.optional() }),
  async authorize(tx, ctx, input) {
    const c = await openConflict(tx, ctx, input.conflictId);
    const cmd = inner[c.command];
    if (!cmd) throw invalid('Этот конфликт нельзя провести');
    if (!cmd.roles.includes(ctx.actor.role)) throw forbidden(cmd.deniedMessage);
    if (input.warehouseId && c.command !== 'movements.create') throw invalid('Склад меняется только у списания');
    const payload = { ...(c.payload as object), quantity: input.quantity, ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}) };
    let parsed: unknown;
    try { parsed = cmd.schema.parse(payload); } catch (e) { if (e instanceof ZodError) throw invalid('Операция в конфликте повреждена'); throw e; }
    const innerCtx: CommandContext = { ...ctx, prov: { origin: 'offline', deviceId: c.deviceId, deviceCreatedAt: c.deviceCreatedAt ?? ctx.prov.serverReceivedAt, serverReceivedAt: ctx.prov.serverReceivedAt, opId: c.opId } };
    const scope = await cmd.authorize(tx, innerCtx, parsed);
    return { c, cmd, parsed, innerCtx, scope };
  },
  async execute(tx, ctx, input, { c, cmd, parsed, innerCtx, scope }) {
    const result = await cmd.execute(tx, innerCtx, parsed, scope) as { id: string };
    const resolution = { quantity: String(input.quantity), warehouseId: input.warehouseId ?? null, entityId: result.id };
    const [row] = await tx.update(syncConflicts).set({ status: 'resolved', resolvedBy: ctx.actor.id, resolvedAt: new Date(), resolution, ...bump(syncConflicts.version) }).where(eq(syncConflicts.id, c.id)).returning();
    await settleOp(tx, c.opId, 'applied', result);
    await audit(tx, ctx, 'conflict_resolve', 'sync_conflict', c.id, c, row);
    changed(ctx, 'sync_conflicts', c.id, c.projectId);
    return row;
  },
});
