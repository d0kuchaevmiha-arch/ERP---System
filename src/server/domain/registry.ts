import { ZodError } from 'zod';
import type { Command } from './command';
import type { CommandContext } from './context';
import { WRITE_ROLES } from './authz';
import { DomainError, forbidden, invalid, notFound } from './errors';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommand = Command<any, any, unknown>;
const list: AnyCommand[] = [organizationsCreate, projectsCreate, tasksCreate, progressSet, budgetsCreate, expensesCreate, materialsCreate, warehousesCreate, counterpartiesCreate, contractsCreate, purchasesCreate, approvalsDecide, purchasesReceive, movementsCreate];
export const commands: Record<string, AnyCommand> = Object.fromEntries(list.map(c => [c.name, c]));

// Ресурсы HTTP API v1 → команды (контракт POST /api/v1/<resource> сохранён).
export const httpCommands: Record<string, string> = {
  organizations: 'organizations.create', projects: 'projects.create', tasks: 'tasks.create', progress: 'progress.set',
  budgets: 'budgets.create', expenses: 'expenses.create', materials: 'materials.create', warehouses: 'warehouses.create',
  suppliers: 'counterparties.create', contracts: 'contracts.create', purchases: 'purchases.create',
  approvals: 'approvals.decide', receive: 'purchases.receive', movements: 'movements.create',
};

// Единая точка записи: роль → валидация → транзакция (authorize + execute).
export async function runCommand(ctx: CommandContext, name: string, raw: unknown) {
  const cmd = commands[name];
  if (!cmd) throw notFound('Операция не найдена');
  if (!(WRITE_ROLES as readonly string[]).includes(ctx.actor.role)) throw forbidden('Недостаточно прав для изменения данных');
  if (!cmd.roles.includes(ctx.actor.role)) throw forbidden('Недостаточно прав для согласования или приемки');
  let input: unknown;
  try { input = cmd.schema.parse(raw); }
  catch (e) { if (e instanceof ZodError) throw invalid('Проверьте поля формы: ' + e.issues.map(i => i.path.join('.')).join(', ')); throw e; }
  return ctx.db.transaction(async tx => {
    const scope = await cmd.authorize(tx, ctx, input);
    return cmd.execute(tx, ctx, input, scope);
  });
}

export { DomainError };
