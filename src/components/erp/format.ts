import type { MarkKind } from './marks';

export const rub = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
export const money = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₽';
export const short = (n: number) => {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}${rub(a / 1_000_000)} млн ₽`;
  if (a >= 1_000) return `${sign}${rub(a / 1_000)} тыс ₽`;
  return `${sign}${rub(a)} ₽`;
};
export const date = (s: string | null | undefined) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dateShort = (s: string | null | undefined) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—');
export const dayMs = 86_400_000;
export const toDay = (s: string) => Math.floor(new Date(s + 'T12:00:00').getTime() / dayMs);
export const daysBetween = (from: string, to: string) => toDay(to) - toDay(from);
export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
export const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'muted';
type Meta = { label: string; mark: MarkKind; tone: Tone };

// Статус — это фигура + подпись; цвет только дублирует смысл.
export const statusMeta: Record<string, Meta> = {
  active: { label: 'В работе', mark: 'active', tone: 'info' },
  risk: { label: 'Риск бюджета', mark: 'over', tone: 'err' },
  delayed: { label: 'Отставание', mark: 'behind', tone: 'err' },
  completed: { label: 'Завершён', mark: 'done', tone: 'ok' },
  done: { label: 'Выполнено', mark: 'done', tone: 'ok' },
  planned: { label: 'Запланировано', mark: 'planned', tone: 'muted' },
  requested: { label: 'Ждёт согласования', mark: 'wait', tone: 'warn' },
  ordered: { label: 'Заказано', mark: 'transit', tone: 'info' },
  partial: { label: 'Принято частично', mark: 'transit', tone: 'info' },
  received: { label: 'Принято', mark: 'done', tone: 'ok' },
  rejected: { label: 'Отклонено', mark: 'blocked', tone: 'err' },
  signed: { label: 'Подписан', mark: 'done', tone: 'ok' },
  draft: { label: 'Черновик', mark: 'planned', tone: 'muted' },
  closed: { label: 'Закрыт', mark: 'done', tone: 'muted' },
};
export const metaOf = (s: string): Meta => statusMeta[s] || { label: s, mark: 'planned', tone: 'muted' };

export const movementLabel: Record<string, string> = { receipt: 'Приход', issue: 'Выдача на объект', writeoff: 'Списание', return: 'Возврат', transfer_in: 'Перемещение (приход)', transfer_out: 'Перемещение (расход)' };
export const isIncoming = (type: string) => ['receipt', 'return', 'transfer_in'].includes(type);
export const partyKindLabel: Record<string, string> = { supplier: 'Поставщик', customer: 'Заказчик', contractor: 'Подрядчик' };
export const taskKindLabel: Record<string, string> = { stage: 'Этап', section: 'Раздел', work: 'Работа', subtask: 'Подзадача' };
export const auditActionLabel: Record<string, string> = { create: 'Создано', approve: 'Согласовано', reject: 'Отклонено', return: 'Возвращено', update: 'Изменено', receive: 'Принято на склад', progress: 'Обновлена готовность' };
export const auditEntityLabel: Record<string, string> = { purchase: 'заявка', task: 'работа', project: 'объект', expense: 'расход', material: 'материал', contract: 'договор', budget: 'бюджет', movement: 'движение', counterparty: 'контрагент', warehouse: 'склад', organization: 'организация', stock_movement: 'движение' };

export function exportCSV(rows: Record<string, unknown>[], name: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = '﻿' + [keys.join(';'), ...rows.map(r => keys.map(k => `"${String(r[k] ?? '').replaceAll('"', '""')}"`).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
