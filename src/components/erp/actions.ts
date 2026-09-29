'use client';
import { useErp } from './context';
import type { Purchase, Task } from './types';

// Быстрые действия над записями: те же POST в API, что и раньше, но без модальных окон.
export function useActions() {
  const { post, notify, create, can } = useErp();
  return {
    canDecide: can('decide'),
    canWrite: can('write'),
    async approve(purchaseId: string, decision: 'approve' | 'reject' = 'approve') {
      const r = await post('approvals', { purchaseId, decision });
      notify(r.ok ? (decision === 'approve' ? 'Заявка согласована' : 'Заявка отклонена') : r.message || 'Операция не выполнена', r.ok ? 'ok' : 'err');
      return r.ok;
    },
    // Принять весь остаток одним действием. Если у заявки не указан склад — просим выбрать его.
    async receiveRest(p: Purchase) {
      const rest = Number(p.quantity) - Number(p.receivedQuantity);
      if (!p.warehouseId) { create('receive', { purchaseId: p.id, warehouseId: '', quantity: String(rest) }); return false; }
      const r = await post('receive', { purchaseId: p.id, warehouseId: p.warehouseId, quantity: rest });
      notify(r.ok ? `Принято: ${p.number}` : r.message || 'Приёмка не выполнена', r.ok ? 'ok' : 'err');
      return r.ok;
    },
    async setProgress(t: Task, progress: number, actualQuantity?: number) {
      const body: Record<string, unknown> = { taskId: t.id, progress };
      if (actualQuantity !== undefined && !Number.isNaN(actualQuantity)) body.actualQuantity = actualQuantity;
      const r = await post('progress', body);
      notify(r.ok ? `Выполнение внесено: ${t.name} — ${progress}%` : r.message || 'Не удалось внести выполнение', r.ok ? 'ok' : 'err');
      return r.ok;
    },
  };
}
