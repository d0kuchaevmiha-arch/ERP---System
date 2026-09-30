import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { devices, purchases, syncConflicts, syncOps, warehouses } from '@/db/schema';
import type { Db, Tx } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';
import { flushChanges } from '@/server/domain/changes';
import { DomainError, invalid } from '@/server/domain/errors';
import { commands, runCommand } from '@/server/domain/registry';
import { payloadHash } from '@/server/domain/idempotency';

// Приём очереди команд с ноутбука (§6.4). Каждая операция — своя транзакция через тот же реестр команд,
// что и HTTP: те же роли, project_access, бизнес-правила, аудит и change_log. Повтор op_id — сохранённый результат.
// Пример из жизни: курьер сдаёт в офис пачку документов — каждый регистрируют отдельно, по порядку,
// а спорные откладывают начальнику участка, а не выбрасывают.

export type PushOp = { opId: string; command: string; payload: unknown; deviceCreatedAt: string; dependsOn?: string[] };
export type PushResult = {
  opId: string;
  status: 'applied' | 'rejected' | 'conflict';
  entityId?: string | null;
  error?: { code: string; message: string };
  conflictId?: string;
};
export const PUSH_LIMIT = 200;

const opSchema = z.object({
  opId: z.string().uuid(), command: z.string().min(1).max(64), payload: z.unknown(),
  deviceCreatedAt: z.string().datetime({ offset: true }), dependsOn: z.array(z.string().uuid()).max(PUSH_LIMIT).optional(),
});
export const pushSchema = z.object({ ops: z.array(opSchema).max(PUSH_LIMIT, `Не больше ${PUSH_LIMIT} операций за раз`) });

// Бизнес-отказы, которые для офлайн-операции означают «спорно», а не «отклонено» (§5.1).
export const CONFLICT_KINDS: Record<string, { command: string; assignedRole: string }> = {
  insufficient_stock: { command: 'movements.create', assignedRole: 'warehouse_manager' },
  over_receipt: { command: 'purchases.receive', assignedRole: 'project_manager' },
};

type Op = typeof syncOps.$inferSelect;
type Stored = { code?: string; message?: string; conflictId?: string; id?: string; factId?: string };

// Коды отказа для клиента: «нет прав на объект» — no_access (§5.1).
// Совпадение id строки, созданной на ноутбуке, с существующей — duplicate_id.
const publicCode = (code: string | undefined) => (code === 'forbidden' ? 'no_access' : code === 'duplicate' ? 'duplicate_id' : code ?? 'rejected');

function fromStored(op: Op, userId: string): PushResult {
  if (op.userId !== userId) return { opId: op.opId, status: 'rejected', error: { code: 'validation', message: 'Ключ операции уже использован' } };
  const r = (op.result ?? {}) as Stored;
  if (op.status === 'applied') return { opId: op.opId, status: 'applied', entityId: r.factId ?? r.id ?? null };
  if (op.status === 'conflict') return { opId: op.opId, status: 'conflict', conflictId: r.conflictId, error: { code: r.code ?? 'conflict', message: r.message ?? 'Требует решения' } };
  return { opId: op.opId, status: 'rejected', error: { code: publicCode(r.code), message: r.message ?? 'Операция отклонена' } };
}

export async function pushOps(db: Db, user: SessionUser, deviceId: string, raw: PushOp[]): Promise<PushResult[]> {
  const parsed = pushSchema.safeParse({ ops: raw });
  if (!parsed.success) throw invalid('Неверный формат пакета: ' + parsed.error.issues.map(i => i.path.join('.')).join(', '));
  const results: PushResult[] = [];
  for (const op of parsed.data.ops) results.push(await pushOne(db, user, deviceId, op));
  await db.update(devices).set({ lastSyncAt: new Date() }).where(eq(devices.id, deviceId));
  return results;
}

async function findOp(db: Db, opId: string) {
  const [op] = await db.select().from(syncOps).where(eq(syncOps.opId, opId));
  return op;
}

async function pushOne(db: Db, user: SessionUser, deviceId: string, op: PushOp): Promise<PushResult> {
  const existing = await findOp(db, op.opId);
  if (existing) return fromStored(existing, user.id);
  const deviceCreatedAt = new Date(op.deviceCreatedAt);
  const reject = (code: string, message: string) => storeReject(db, user, deviceId, op, deviceCreatedAt, code, message);

  const cmd = commands[op.command];
  if (!cmd) return reject('validation', 'Операция не найдена');
  if (cmd.offline === 'online_only') return reject('online_only', 'Эта операция выполняется только при наличии связи');
  if (op.dependsOn?.length) {
    const deps = await db.select({ status: syncOps.status }).from(syncOps).where(inArray(syncOps.opId, op.dependsOn));
    if (deps.some(d => d.status === 'rejected')) return reject('dependency_rejected', 'Отклонена операция, от которой зависит эта (например, приход, из которого сделан расход)');
  }
  // Введено на ноутбуке, пока пользователь был заблокирован (последний интервал блокировки).
  if (user.blockedAt && user.unblockedAt && deviceCreatedAt >= user.blockedAt && deviceCreatedAt < user.unblockedAt)
    return reject('user_blocked', 'Операция введена, когда пользователь был заблокирован');

  try {
    const data = await runCommand({ db, actor: user, ip: null, userAgent: 'sync-push', prov: { origin: 'offline', deviceId, deviceCreatedAt, opId: op.opId } }, op.command, op.payload) as Stored;
    return { opId: op.opId, status: 'applied', entityId: data?.factId ?? data?.id ?? null };
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (cmd.offline === 'conflictable' && CONFLICT_KINDS[e.code]?.command === op.command) await toConflict(db, user, deviceId, op, deviceCreatedAt, e);
    const stored = await findOp(db, op.opId);
    // Отказ до записи в sync_ops (например, повтор ключа с другими данными) — не сохраняется, отдаём как есть.
    return stored ? fromStored(stored, user.id) : { opId: op.opId, status: 'rejected', error: { code: publicCode(e.code), message: e.message } };
  }
}

// Отказ по общим правилам приёма сохраняется, чтобы повтор пакета дал тот же ответ.
async function storeReject(db: Db, user: SessionUser, deviceId: string, op: PushOp, deviceCreatedAt: Date, code: string, message: string): Promise<PushResult> {
  await db.insert(syncOps).values({ opId: op.opId, deviceId, userId: user.id, command: op.command, payloadHash: payloadHash(op.command, op.payload), status: 'rejected', httpStatus: 422, result: { code, message }, deviceCreatedAt })
    .onConflictDoNothing();
  return fromStored((await findOp(db, op.opId))!, user.id);
}

// Отказ «не хватает остатка» / «больше заказа» → конфликт для людей: запись в sync_conflicts,
// статус операции conflict. Условный UPDATE: параллельный повтор того же op не создаст второй конфликт.
async function toConflict(db: Db, user: SessionUser, deviceId: string, op: PushOp, deviceCreatedAt: Date, e: DomainError) {
  const kind = CONFLICT_KINDS[e.code];
  await db.transaction(async tx => {
    const [claimed] = await tx.update(syncOps).set({ status: 'conflict', httpStatus: 409 })
      .where(and(eq(syncOps.opId, op.opId), eq(syncOps.status, 'rejected'))).returning({ opId: syncOps.opId });
    if (!claimed) return;
    const projectId = await conflictProject(tx, user, op);
    const [c] = await tx.insert(syncConflicts).values({
      opId: op.opId, organizationId: user.organizationId, projectId, kind: e.code, command: op.command, payload: op.payload as object,
      reason: e.message, assignedRole: kind.assignedRole, authorId: user.id, deviceId, deviceCreatedAt,
    }).returning({ id: syncConflicts.id });
    await tx.update(syncOps).set({ result: { code: e.code, message: e.message, conflictId: c.id } }).where(eq(syncOps.opId, op.opId));
    await flushChanges(tx, user.organizationId, [{ entity: 'sync_conflicts', entityId: c.id, projectId }]);
  });
}

// Объект спорной операции: склад объекта или объект заявки (для прав на разбор и видимости).
async function conflictProject(tx: Tx, user: SessionUser, op: PushOp): Promise<string | null> {
  const p = (op.payload ?? {}) as { warehouseId?: string; projectId?: string; purchaseId?: string };
  if (op.command === 'purchases.receive' && p.purchaseId) {
    const [row] = await tx.select({ projectId: purchases.projectId }).from(purchases).where(and(eq(purchases.id, p.purchaseId), eq(purchases.organizationId, user.organizationId)));
    return row?.projectId ?? null;
  }
  if (p.warehouseId) {
    const [w] = await tx.select({ projectId: warehouses.projectId }).from(warehouses).where(and(eq(warehouses.id, p.warehouseId), eq(warehouses.organizationId, user.organizationId)));
    if (w?.projectId) return w.projectId;
  }
  return p.projectId ?? null;
}
