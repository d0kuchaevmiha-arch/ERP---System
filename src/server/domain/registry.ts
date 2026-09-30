import { ZodError } from 'zod';
import type { Command } from './command';
import { resolveContext, type CommandContext, type CommandRequest } from './context';
import { flushChanges } from './changes';
import { OpTaken, claimOp, findOp, payloadHash, replay, storeRejection, storeResult } from './idempotency';
import { DomainError, conflict, forbidden, invalid, notFound } from './errors';
import organizationsCreate from './commands/organizations-create';
import projectsCreate from './commands/projects-create';
import tasksCreate from './commands/tasks-create';
import progressSet from './commands/progress-set';
import budgetsCreate from './commands/budgets-create';
import expensesCreate from './commands/expenses-create';
import materialsCreate from './commands/materials-create';
import warehousesCreate from './commands/warehouses-create';
import counterpartiesCreate from './commands/counterparties-create';
import contractsCreate from './commands/contracts-create';
import purchasesCreate from './commands/purchases-create';
import approvalsDecide from './commands/approvals-decide';
import purchasesReceive from './commands/purchases-receive';
import movementsCreate from './commands/movements-create';
import usersCreate from './commands/users-create';
import usersUpdate from './commands/users-update';
import usersResetPassword from './commands/users-reset-password';
import accessSet from './commands/access-set';
import accessRemove from './commands/access-remove';
import authChangePassword from './commands/auth-change-password';
import devicesRevoke from './commands/devices-revoke';

type AnyCommand = Command<any, any, unknown>;
const list: AnyCommand[] = [
  organizationsCreate, projectsCreate, tasksCreate, progressSet, budgetsCreate, expensesCreate, materialsCreate, warehousesCreate,
  counterpartiesCreate, contractsCreate, purchasesCreate, approvalsDecide, purchasesReceive, movementsCreate,
  usersCreate, usersUpdate, usersResetPassword, accessSet, accessRemove, authChangePassword, devicesRevoke,
];
export const commands: Record<string, AnyCommand> = Object.fromEntries(list.map(c => [c.name, c]));

// Ресурсы HTTP API v1 → команды (контракт POST /api/v1/<resource> сохранён).
export const httpCommands: Record<string, string> = {
  organizations: 'organizations.create', projects: 'projects.create', tasks: 'tasks.create', progress: 'progress.set',
  budgets: 'budgets.create', expenses: 'expenses.create', materials: 'materials.create', warehouses: 'warehouses.create',
  suppliers: 'counterparties.create', contracts: 'contracts.create', purchases: 'purchases.create',
  approvals: 'approvals.decide', receive: 'purchases.receive', movements: 'movements.create',
};

// Единая точка записи: [ключ операции] → роль → валидация → транзакция (authorize + execute + change_log).
export async function runCommand(req: CommandRequest, name: string, raw: unknown) {
  const ctx = resolveContext(req);
  const opId = ctx.prov.opId;
  if (!opId) return execute(ctx, name, raw);
  const hash = payloadHash(name, raw);
  const existing = await findOp(ctx.db, opId);
  if (existing) return replay(existing, ctx, name, hash);
  try {
    return await execute(ctx, name, raw, hash);
  } catch (e) {
    if (e instanceof OpTaken) return replay((await findOp(ctx.db, opId))!, ctx, name, hash);
    if (e instanceof DomainError && !(await storeRejection(ctx.db, ctx, name, hash, e))) return replay((await findOp(ctx.db, opId))!, ctx, name, hash);
    throw e;
  }
}

async function execute(ctx: CommandContext, name: string, raw: unknown, hash?: string) {
  const cmd = commands[name];
  if (!cmd) throw notFound('Операция не найдена');
  // Пока временный пароль не сменён, доступна только смена пароля.
  if (ctx.actor.mustChangePassword && cmd !== authChangePassword) throw forbidden('Смените пароль, чтобы продолжить');
  if (!cmd.roles.includes(ctx.actor.role)) throw forbidden(cmd.deniedMessage ?? 'Недостаточно прав для изменения данных');
  let input: unknown;
  try { input = cmd.schema.parse(raw); }
  catch (e) { if (e instanceof ZodError) throw invalid('Проверьте поля формы: ' + e.issues.map(i => i.path.join('.')).join(', ')); throw e; }
  try {
    return await ctx.db.transaction(async tx => {
      if (hash) await claimOp(tx, ctx, name, hash);
      const scope = await cmd.authorize(tx, ctx, input);
      const result = await cmd.execute(tx, ctx, input, scope);
      const signal = await flushChanges(tx, ctx.actor.organizationId, ctx.changes);
      if (ctx.meta && signal) ctx.meta.maxSeq = signal.maxSeq;
      if (hash) await storeResult(tx, ctx.prov.opId!, result);
      return result;
    });
  } catch (e) {
    // Нарушение уникальности (гонка двух одинаковых созданий) — понятный 409 вместо текста ошибки БД.
    if (pgCode(e) === '23505') throw new DomainError('Запись с такими данными уже существует', 409, 'duplicate');
    throw e;
  }
}
function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}

export { DomainError };
