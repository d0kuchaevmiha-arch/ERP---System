import { randomUUID } from 'node:crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { stockMovements } from '@/db/schema';
import { localRows, outbox, syncState } from '@/client/db/schema';
import type { Db, Tx } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';
import { commands } from '@/server/domain/registry';
import { resolveContext } from '@/server/domain/context';
import { CHANGES_CHANNEL } from '@/server/domain/changes';
import { DomainError, forbidden, invalid, notFound } from '@/server/domain/errors';
import { AGENT_CHANNEL } from '@/client/local/forward';
import { APPLIERS } from './appliers';

// Офлайн-запись на ноутбуке (§3.1, §6.6, решения P4 №1–3, 5, 8): те же роль, Zod-схема и authorize, что на сервере,
// но по реплике; затем оптимистичная строка + операция в outbox — одной локальной транзакцией.
// Окончательное решение всегда за сервером: sync-agent отправит операцию, как только будет связь.
export type LocalWrite = { opId: string; id: string | null; data: unknown };
export type OutboxOp = { opId: string; command: string; payload: unknown; deviceCreatedAt: Date };

export const ACTIVE = ['pending', 'sending', 'conflict'] as const;

export const isOfflineCommand = (name: string) => Boolean(APPLIERS[name]) && commands[name]?.offline !== 'online_only';

function parse(name: string, payload: unknown) {
  try { return commands[name].schema.parse(payload); }
  catch (e) { if (e instanceof ZodError) throw invalid('Проверьте поля формы: ' + e.issues.map(i => i.path.join('.')).join(', ')); throw e; }
}

// Вход операции как его увидит сервер: id строки создаёт клиент; временный номер заявки;
// у приёмки нет version — исход офлайн-приёмки решает количество (решение P4 №9).
function prepare(name: string, raw: unknown) {
  const p: Record<string, unknown> & { id: string } = { ...(raw as Record<string, unknown>), id: randomUUID() };
  if (name === 'purchases.create' && !p.localRef) p.localRef = `ЛОК-${randomUUID().slice(0, 6).toUpperCase()}`;
  if (name === 'purchases.receive') delete p.version;
  return p;
}

// Оптимистичное применение операции к реплике (при вводе и повторно — после перезагрузки реплики).
export async function applyOptimistic(tx: Tx, user: SessionUser, deviceId: string, op: OutboxOp) {
  const cmd = commands[op.command];
  const input = parse(op.command, op.payload);
  const ctx = resolveContext({ db: tx as unknown as Db, actor: user, ip: null, userAgent: 'desktop', prov: { origin: 'offline', deviceId, deviceCreatedAt: op.deviceCreatedAt, opId: op.opId } });
  const scope = await cmd.authorize(tx, ctx, input);
  return APPLIERS[op.command]({ tx, ctx, opId: op.opId }, input, scope);
}

export async function writeLocal(db: Db, user: SessionUser, command: string, raw: unknown): Promise<LocalWrite> {
  const cmd = commands[command];
  if (!cmd) throw notFound('Операция не найдена');
  if (!isOfflineCommand(command)) throw new DomainError('Нужна связь с сервером: эта операция выполняется только онлайн', 503, 'online_only');
  if (user.mustChangePassword) throw forbidden('Смените пароль, чтобы продолжить');
  if (!cmd.roles.includes(user.role)) throw forbidden(cmd.deniedMessage ?? 'Недостаточно прав для изменения данных');
  const payload = prepare(command, raw);
  parse(command, payload);
  const [st] = await db.select().from(syncState).where(eq(syncState.id, 1));
  if (!st) throw new DomainError('Устройство не подключено к серверу', 503, 'not_registered');
  const op: OutboxOp = { opId: randomUUID(), command, payload, deviceCreatedAt: new Date() };

  const id = await db.transaction(async tx => {
    // Локальные записи — по одной: предпроверка остатка видит все предыдущие операции очереди.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp_outbox'))`);
    const dependsOn = await dependenciesOf(tx, op);
    await tx.insert(outbox).values({ opId: op.opId, command, payload, deviceCreatedAt: op.deviceCreatedAt, dependsOn, entityId: payload.id });
    const created = await applyOptimistic(tx, user, st.deviceId, op);
    await tx.execute(sql`select pg_notify(${CHANGES_CHANNEL}, ${JSON.stringify({ org: user.organizationId, projectIds: [], orgWide: true, maxSeq: st.lastSeq })})`);
    await tx.execute(sql`select pg_notify(${AGENT_CHANNEL}, 'push')`);
    return created;
  });
  return { opId: op.opId, id, data: { ...payload, id } };
}

// Зависимости (решение P4 №8): неотправленные операции, создавшие строки, на которые ссылается вход
// (например, приёмка по офлайн-заявке), и приход/возврат на ту же пару «материал + склад» перед списанием.
async function dependenciesOf(tx: Tx, op: OutboxOp): Promise<string[]> {
  const p = op.payload as Record<string, unknown>;
  const refs = Object.entries(p).filter(([k, v]) => k !== 'id' && k.endsWith('Id') && typeof v === 'string').map(([, v]) => v as string);
  const deps = new Set<string>();
  if (refs.length) {
    const rows = await tx.select({ opId: localRows.opId }).from(localRows).innerJoin(outbox, eq(outbox.opId, localRows.opId))
      .where(and(inArray(localRows.entityId, refs), inArray(outbox.status, [...ACTIVE]), sql`${localRows.before} is null`));
    rows.forEach(r => deps.add(r.opId));
  }
  if (op.command === 'movements.create' && (p.type === 'issue' || p.type === 'writeoff')) {
    const rows = await tx.select({ opId: localRows.opId }).from(localRows)
      .innerJoin(outbox, eq(outbox.opId, localRows.opId))
      .innerJoin(stockMovements, eq(stockMovements.id, localRows.entityId))
      .where(and(eq(localRows.entity, 'stock_movements'), inArray(outbox.status, [...ACTIVE]), eq(stockMovements.materialId, String(p.materialId)), eq(stockMovements.warehouseId, String(p.warehouseId)), inArray(stockMovements.type, ['receipt', 'return']), ne(outbox.opId, op.opId)));
    rows.forEach(r => deps.add(r.opId));
  }
  return [...deps];
}
