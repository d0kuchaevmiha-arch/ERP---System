import type { Data, DrawerRef, Project, Purchase, Task } from './types';
import { daysBetween, days, short, plural } from './format';
import type { MarkKind } from './marks';
import type { Tone } from './format';

export const purchaseAmount = (p: Purchase) => Number(p.quantity) * Number(p.unitPrice);
export const receivedAmount = (p: Purchase) => Number(p.receivedQuantity) * Number(p.unitPrice);
export const lateDays = (t: { endDate: string | null }, today: string) => (t.endDate ? Math.max(0, daysBetween(t.endDate, today)) : 0);

// Доля срока, прошедшая по календарю (0–100): это «план» для шкалы готовности.
export function elapsedShare(start: string | null, end: string | null, today: string): number {
  if (!start || !end) return 0;
  const total = daysBetween(start, end);
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, (daysBetween(start, today) / total) * 100));
}

export type Deviation = { mark: MarkKind; tone: Tone; text: string };
export type ProjectDeviations = { schedule: Deviation; budget: Deviation; supply: Deviation; lateTasks: Task[]; latePurchases: Purchase[]; pending: Purchase[] };

// Отклонения по объекту: срок / бюджет / снабжение. Считаем только то, что реально есть в данных.
export function deviations(data: Data, p: Project, today: string): ProjectDeviations {
  const lateTasks = data.tasks.filter(t => t.projectId === p.id && t.delayed);
  const maxLate = lateTasks.reduce((m, t) => Math.max(m, lateDays(t, today)), 0);
  const buys = data.purchases.filter(x => x.projectId === p.id);
  const latePurchases = buys.filter(x => x.delayed);
  const pending = buys.filter(x => x.status === 'requested');
  const schedule: Deviation = lateTasks.length
    ? { mark: 'behind', tone: 'err', text: `${lateTasks.length} ${plural(lateTasks.length, 'работа', 'работы', 'работ')} позже срока, до ${days(maxLate)}` }
    : { mark: 'done', tone: 'ok', text: 'в графике' };
  const budget: Deviation = p.variance < 0
    ? { mark: 'over', tone: 'err', text: `прогноз выше плана на ${short(-p.variance)}` }
    : { mark: 'done', tone: 'ok', text: p.budget ? `резерв ${short(p.variance)}` : 'бюджет не задан' };
  const supply: Deviation = latePurchases.length
    ? { mark: 'behind', tone: 'err', text: `${latePurchases.length} ${plural(latePurchases.length, 'поставка просрочена', 'поставки просрочены', 'поставок просрочено')}` }
    : pending.length
      ? { mark: 'wait', tone: 'warn', text: `${pending.length} ${plural(pending.length, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} согласования` }
      : { mark: 'done', tone: 'ok', text: 'без замечаний' };
  return { schedule, budget, supply, lateTasks, latePurchases, pending };
}

export type QueueAction =
  | { type: 'approve'; id: string }
  | { type: 'receive'; id: string }
  | { type: 'drawer'; ref: NonNullable<DrawerRef> }
  | { type: 'purchase'; materialId: string; projectId?: string }
  | { type: 'progress'; id: string };
export type QueueItem = { id: string; mark: MarkKind; tone: Tone; title: string; where: string; why: string; score: number; actionLabel: string; action: QueueAction; project?: string };

// Очередь решений: что сделать сейчас, по убыванию срочности.
export function buildQueue(data: Data, today: string, canDecide: boolean, scopeId: string): QueueItem[] {
  const inScope = (projectId: string | null | undefined) => !scopeId || projectId === scopeId;
  const q: QueueItem[] = [];
  for (const p of data.purchases) {
    if (!inScope(p.projectId)) continue;
    if (p.delayed && p.dueAt) {
      const d = daysBetween(p.dueAt, today);
      q.push({ id: 'late-' + p.id, mark: 'behind', tone: 'err', title: `Поставка ${p.number} просрочена`, where: `${p.project} · ${p.material}`, why: `срок был ${new Date(p.dueAt + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}, прошло ${days(d)}, принято ${Number(p.receivedQuantity)} из ${Number(p.quantity)}`, score: 700 + d, actionLabel: 'Принять', action: canDecide ? { type: 'receive', id: p.id } : { type: 'drawer', ref: { kind: 'purchase', id: p.id } } });
    } else if (p.status === 'requested') {
      q.push({ id: 'req-' + p.id, mark: 'wait', tone: 'warn', title: `Заявка ${p.number} ждёт согласования`, where: `${p.project} · ${p.material}`, why: `${Number(p.quantity)} × ${short(Number(p.unitPrice))} = ${short(purchaseAmount(p))}${p.dueAt ? `, нужна к ${new Date(p.dueAt + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}` : ''}`, score: 500 + (p.dueAt ? Math.max(0, 60 - daysBetween(today, p.dueAt)) : 0), actionLabel: canDecide ? 'Согласовать' : 'Открыть', action: canDecide ? { type: 'approve', id: p.id } : { type: 'drawer', ref: { kind: 'purchase', id: p.id } } });
    }
  }
  for (const m of data.materials) {
    if (!m.shortage) continue;
    q.push({ id: 'short-' + m.id, mark: 'over', tone: 'err', title: `${m.name}: остаток ниже минимума`, where: 'Склад', why: `на складе ${m.balance} ${m.unit}, неснижаемый остаток ${Number(m.minStock)} ${m.unit}`, score: 600 + Math.round((1 - m.balance / Math.max(1, Number(m.minStock))) * 50), actionLabel: 'Заявка', action: { type: 'purchase', materialId: m.id, projectId: scopeId || undefined } });
  }
  for (const t of data.tasks) {
    if (!t.delayed || !inScope(t.projectId)) continue;
    const d = lateDays(t, today);
    q.push({ id: 'task-' + t.id, mark: 'behind', tone: 'err', title: `${t.name} — отставание ${days(d)}`, where: t.project, why: `готовность ${t.progress}%, срок был ${new Date((t.endDate as string) + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}`, score: 400 + d, actionLabel: 'Внести выполнение', action: { type: 'progress', id: t.id } });
  }
  for (const p of data.projects) {
    if (!inScope(p.id) || p.variance >= 0) continue;
    q.push({ id: 'over-' + p.id, mark: 'over', tone: 'err', title: `${p.name}: прогноз выше бюджета`, where: p.code, why: `план ${short(p.budget)}, факт ${short(p.actual)}, прогноз ${short(p.forecast)}`, score: 650, actionLabel: 'Открыть', action: { type: 'drawer', ref: { kind: 'project', id: p.id } } });
  }
  for (const p of data.purchases) {
    if (!inScope(p.projectId) || p.delayed) continue;
    if (['ordered', 'partial'].includes(p.status)) {
      q.push({ id: 'in-' + p.id, mark: 'transit', tone: 'info', title: `Ожидается приёмка ${p.number}`, where: `${p.project} · ${p.material}`, why: `осталось принять ${Number(p.quantity) - Number(p.receivedQuantity)}${p.dueAt ? `, срок ${new Date(p.dueAt + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}` : ''}`, score: 100, actionLabel: canDecide ? 'Принять' : 'Открыть', action: canDecide ? { type: 'receive', id: p.id } : { type: 'drawer', ref: { kind: 'purchase', id: p.id } } });
    }
  }
  return q.sort((a, b) => b.score - a.score);
}
