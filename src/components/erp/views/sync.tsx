'use client';
import { useState } from 'react';
import { useErp } from '../context';
import { Empty, Sheet, ClientTime } from '../ui';
import { rub } from '../format';
import type { Data } from '../types';

// «Требует решения» (браузер и десктоп) и «Не принято сервером» / «Очередь» (только десктоп), §6.6, решение P4 №6–7.
// Пример из жизни: лоток «на подпись» у кладовщика и лоток «вернули с резолюцией» у прораба.

type Conflict = Data['conflicts'][number];
type OutboxItem = NonNullable<Data['sync']>['outbox'][number];
type Payload = { materialId?: string; warehouseId?: string; quantity?: number | string; type?: string; taskId?: string; progress?: number; description?: string; amount?: string; purchaseId?: string; projectId?: string };

const commandLabel: Record<string, string> = {
  'progress.set': 'Выполнение работы', 'expenses.create': 'Расход', 'purchases.create': 'Заявка на материал', 'purchases.receive': 'Приёмка поставки',
};
const movementLabel: Record<string, string> = { receipt: 'Приход', issue: 'Выдача', return: 'Возврат', writeoff: 'Списание' };
const kindLabel: Record<string, string> = { insufficient_stock: 'Не хватило остатка', over_receipt: 'Приёмка больше заказа' };
const statusLabel: Record<string, string> = { pending: 'В очереди', sending: 'Отправляется', conflict: 'Требует решения', rejected: 'Не принято' };
const codeLabel: Record<string, string> = {
  no_access: 'Нет прав на объект', dependency_rejected: 'Отклонена связанная операция', user_blocked: 'Пользователь был заблокирован',
  duplicate_id: 'Запись уже существует', conflict_discarded: 'Отклонено при разборе', business_rule: 'Нарушено правило', validation: 'Ошибка в данных',
  not_found: 'Не найдено на сервере', online_only: 'Только онлайн',
};
const RESOLVERS: Record<string, string[]> = {
  insufficient_stock: ['warehouse_manager', 'project_manager', 'director', 'super_admin'],
  over_receipt: ['project_manager', 'procurement_manager', 'director', 'super_admin'],
};
const whoResolves: Record<string, string> = { insufficient_stock: 'кладовщик или руководитель проекта', over_receipt: 'руководитель проекта или снабженец' };

function useDescribe() {
  const { data } = useErp();
  return (command: string, raw: unknown) => {
    const p = (raw ?? {}) as Payload;
    const mat = data.materials.find(m => m.id === p.materialId);
    const purchase = data.purchases.find(x => x.id === p.purchaseId);
    const pm = purchase ? data.materials.find(m => m.id === purchase.materialId) : undefined;
    const task = data.tasks.find(t => t.id === p.taskId);
    const title = command === 'movements.create' ? movementLabel[p.type ?? ''] ?? 'Движение' : commandLabel[command] ?? command;
    const detail = command === 'movements.create' ? `${mat?.name ?? 'материал'} · ${rub(Number(p.quantity))} ${mat?.unit ?? ''}`
      : command === 'purchases.receive' ? `${purchase?.number ?? 'заявка'} · ${rub(Number(p.quantity))} ${pm?.unit ?? ''}`
      : command === 'purchases.create' ? `${mat?.name ?? 'материал'} · ${rub(Number(p.quantity))} ${mat?.unit ?? ''}`
      : command === 'progress.set' ? `${task?.name ?? 'работа'} · ${p.progress}%`
      : command === 'expenses.create' ? `${p.description ?? ''} · ${p.amount ?? ''} ₽` : '';
    return { title, detail };
  };
}

export function SyncView({ sub }: { sub: string }) {
  if (sub === 'rejected') return <OutboxView mode="rejected" />;
  if (sub === 'queue') return <OutboxView mode="queue" />;
  return <ConflictsView />;
}

function ConflictsView() {
  const { data, user } = useErp();
  const open = data.conflicts.filter(c => c.status === 'open');
  return (
    <div className="page">
      <header className="page-head"><div><h1 className="disp">Требует решения</h1>
        <p className="muted">Операции, введённые без связи, которые сервер не смог провести автоматически. Данные не потеряны — решите, провести их с исправлением или отклонить.</p></div></header>
      <Sheet title="Спорные операции" aside={open.length}>
        {open.length === 0 ? <Empty title="Спорных операций нет" hint="Если офлайн-ввод разойдётся с данными сервера, операция появится здесь." /> : (
          <ul className="conflict-list">{open.map(c => <ConflictCard key={c.id} c={c} canResolve={Boolean(user && RESOLVERS[c.kind]?.includes(user.role))} />)}</ul>
        )}
      </Sheet>
    </div>
  );
}

function ConflictCard({ c, canResolve }: { c: Conflict; canResolve: boolean }) {
  const { data, post, notify, online } = useErp();
  const describe = useDescribe();
  const d = describe(c.command, c.payload);
  const p = c.payload as Payload;
  const author = data.people.find(u => u.id === c.authorId)?.name ?? 'сотрудник';
  const project = data.projects.find(x => x.id === c.projectId);
  const [mode, setMode] = useState<'' | 'resolve' | 'discard'>('');
  const [quantity, setQuantity] = useState(String(p.quantity ?? ''));
  const [warehouseId, setWarehouseId] = useState(p.warehouseId ?? '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const warehouses = data.warehouses.filter(w => !w.projectId || w.projectId === c.projectId);

  async function submit() {
    setBusy(true);
    const r = mode === 'resolve'
      ? await post('conflict-resolve', { conflictId: c.id, quantity, ...(c.command === 'movements.create' && warehouseId !== p.warehouseId ? { warehouseId } : {}) })
      : await post('conflict-discard', { conflictId: c.id, comment });
    setBusy(false);
    notify(r.ok ? (mode === 'resolve' ? 'Операция проведена' : 'Операция отклонена, автор увидит причину') : r.message || 'Не выполнено', r.ok ? 'ok' : 'err');
    if (r.ok) setMode('');
  }

  return (
    <li className="conflict-card">
      <div className="conflict-head"><b>{d.title}: {d.detail}</b><span className="tag" data-tone="err">{kindLabel[c.kind] ?? c.kind}</span></div>
      <p className="muted small">{author} · введено <ClientTime value={c.deviceCreatedAt ?? c.createdAt} />{project ? ` · ${project.code} ${project.name}` : ''}</p>
      <p>{c.reason}</p>
      {!canResolve && <p className="muted small">Решает {whoResolves[c.kind] ?? 'ответственный'} объекта.</p>}
      {canResolve && !online && <p className="muted small">Нужна связь с сервером, чтобы решить.</p>}
      {canResolve && online && mode === '' && (
        <div className="head-actions"><button type="button" className="btn btn-mark" onClick={() => setMode('resolve')}>Провести с исправлением</button><button type="button" className="btn" onClick={() => setMode('discard')}>Отклонить</button></div>
      )}
      {mode === 'resolve' && (
        <form className="conflict-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <label>Количество<input inputMode="decimal" required value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
          {c.command === 'movements.create' && <label>Склад<select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
          <button className="btn btn-mark" disabled={busy}>{busy ? '…' : 'Провести'}</button><button type="button" className="btn" onClick={() => setMode('')}>Отмена</button>
        </form>
      )}
      {mode === 'discard' && (
        <form className="conflict-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <label>Причина (увидит автор)<input required minLength={3} value={comment} onChange={e => setComment(e.target.value)} /></label>
          <button className="btn btn-mark" disabled={busy}>{busy ? '…' : 'Отклонить'}</button><button type="button" className="btn" onClick={() => setMode('')}>Отмена</button>
        </form>
      )}
    </li>
  );
}

function OutboxView({ mode }: { mode: 'rejected' | 'queue' }) {
  const { data, refresh, notify } = useErp();
  const describe = useDescribe();
  const items = (data.sync?.outbox ?? []).filter((o: OutboxItem) => (mode === 'rejected' ? o.status === 'rejected' : o.status !== 'rejected'));
  async function hide(opId: string) {
    const r = await fetch('/api/client/outbox/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opId }) });
    if (r.ok) await refresh(); else notify('Не удалось скрыть', 'err');
  }
  return (
    <div className="page">
      <header className="page-head">
        <div><h1 className="disp">{mode === 'rejected' ? 'Не принято сервером' : 'Очередь отправки'}</h1>
          <p className="muted">{mode === 'rejected' ? 'Операции, которые сервер отклонил. На ноутбуке они отменены; то, что вы вводили, и причина — ниже.' : 'Введено на ноутбуке и ещё не принято сервером. Отправится автоматически при связи.'}</p></div>
        <div className="head-actions"><a className="btn" href="/api/client/outbox/export" download>Экспорт очереди в файл</a></div>
      </header>
      <Sheet title={mode === 'rejected' ? 'Отклонённые' : 'В очереди'} aside={items.length}>
        {items.length === 0 ? <Empty title={mode === 'rejected' ? 'Отклонённых нет' : 'Очередь пуста'} hint={mode === 'rejected' ? 'Всё, что вы ввели, принято сервером.' : 'Все изменения отправлены.'} /> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl">
            <thead><tr><th>Введено</th><th>Операция</th><th>Что</th><th>Состояние</th>{mode === 'rejected' && <th>Причина</th>}{mode === 'rejected' && <th />}</tr></thead>
            <tbody>{items.map(o => { const d = describe(o.command, o.payload); return (
              <tr key={o.opId}>
                <td><ClientTime value={o.deviceCreatedAt} /></td><td>{d.title}</td><td>{d.detail}</td>
                <td><span className="tag" data-tone={o.status === 'rejected' || o.status === 'conflict' ? 'err' : 'warn'}>{statusLabel[o.status] ?? o.status}</span></td>
                {mode === 'rejected' && <td><b>{codeLabel[o.errorCode ?? ''] ?? o.errorCode}</b><small className="sub">{o.error}</small></td>}
                {mode === 'rejected' && <td><button type="button" className="btn" onClick={() => void hide(o.opId)}>Скрыть</button></td>}
              </tr>); })}</tbody>
          </table></div>
        )}
      </Sheet>
    </div>
  );
}
