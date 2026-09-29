'use client';
import { useState } from 'react';
import { useErp } from '../context';
import { useActions } from '../actions';
import { Empty, Segmented, Sheet, Status, useMedia, useStored } from '../ui';
import { PurchaseAction } from '../parts';
import { Mark } from '../marks';
import { purchaseAmount } from '../derive';
import { date, dateShort, exportCSV, metaOf, rub, short } from '../format';
import type { Purchase } from '../types';

type FilterKey = 'all' | 'wait' | 'transit' | 'late' | 'done';
const filterFn: Record<FilterKey, (p: Purchase) => boolean> = {
  all: () => true,
  wait: p => p.status === 'requested',
  transit: p => ['ordered', 'partial'].includes(p.status),
  late: p => p.delayed,
  done: p => p.status === 'received',
};

export function ProcurementView() {
  const erp = useErp();
  const { data, scopeId, openDrawer, create, notify, post } = erp;
  const acts = useActions();
  const [mode, setMode] = useStored<'table' | 'stages'>('erp.procurement', 'table', ['table', 'stages']);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const phone = useMedia('(max-width: 480px)');
  const scoped = data.purchases.filter(p => !scopeId || p.projectId === scopeId);
  const list = scoped.filter(filterFn[filter]);
  const count = (k: FilterKey) => scoped.filter(filterFn[k]).length;
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickedRows = scoped.filter(p => picked.has(p.id));
  const approvable = pickedRows.filter(p => p.status === 'requested');

  async function approveMany() {
    setBusy(true);
    let ok = 0; let fail = '';
    for (const p of approvable) {
      const r = await post('approvals', { purchaseId: p.id, decision: 'approve' });
      if (r.ok) ok++; else fail = r.message || 'Не удалось согласовать часть заявок';
    }
    setBusy(false); setPicked(new Set());
    notify(fail ? `Согласовано ${ok} из ${approvable.length}. ${fail}` : `Согласовано заявок: ${ok}`, fail ? 'err' : 'ok');
  }

  const chips: { k: FilterKey; label: string }[] = [{ k: 'all', label: 'Все' }, { k: 'wait', label: 'Ждут согласования' }, { k: 'transit', label: 'В пути' }, { k: 'late', label: 'Просрочены' }, { k: 'done', label: 'Приняты' }];

  return (
    <div className="page">
      <header className="page-head">
        <div><h1 className="disp">Закупки</h1><p className="muted">От потребности до приёмки на склад · {scoped.length} заявок</p></div>
        {acts.canWrite && <button className="btn btn-mark" onClick={() => create('purchase', scopeId ? { projectId: scopeId } : {})}>Создать заявку</button>}
      </header>
      <Sheet
        title="Реестр заявок"
        aside={list.length}
        actions={<Segmented label="Вид закупок" value={mode} onChange={setMode} options={[{ value: 'table', label: 'Таблица' }, { value: 'stages', label: 'Этапы' }]} />}
      >
        <div className="chips" role="group" aria-label="Фильтр по статусу">
          {chips.map(c => <button key={c.k} className="chip" aria-pressed={filter === c.k} onClick={() => { setFilter(c.k); setPicked(new Set()); }}>{c.label}<span className="chip-count">{count(c.k)}</span></button>)}
        </div>
        {picked.size > 0 && (
          <div className="bulkbar" role="region" aria-label="Действия с выбранными заявками">
            <b>Выбрано: {picked.size}</b>
            {acts.canDecide && approvable.length > 0 && <button className="btn btn-mark" disabled={busy} onClick={approveMany}>{busy ? 'Согласуем…' : `Согласовать (${approvable.length})`}</button>}
            <button className="btn" onClick={() => exportCSV(pickedRows, 'purchases-selected')}>Экспортировать</button>
            <button className="btn" onClick={() => setPicked(new Set())}>Снять выбор</button>
          </div>
        )}
        {list.length === 0 ? (
          <Empty title="Заявок нет" hint={filter === 'all' ? 'Создайте заявку на материал — она уйдёт на согласование.' : 'В этом фильтре заявок нет. Выберите «Все».'} action={acts.canWrite && filter === 'all' ? 'Создать заявку' : undefined} onAction={() => create('purchase', scopeId ? { projectId: scopeId } : {})} />
        ) : mode === 'table' && !phone ? (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl">
            <thead><tr>
              <th className="chk"><input type="checkbox" aria-label="Выбрать все заявки" checked={picked.size === list.length} onChange={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map(p => p.id)))} /></th>
              <th>Заявка</th><th>Объект</th><th>Поставщик</th><th className="r">Принято / заказано</th><th className="r">Сумма</th><th>Нужно к</th><th>Статус</th><th>Действие</th>
            </tr></thead>
            <tbody>{list.map(p => (
              <tr key={p.id} data-picked={picked.has(p.id) || undefined}>
                <td className="chk"><input type="checkbox" aria-label={`Выбрать заявку ${p.number}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                <td><button className="link strong" onClick={() => openDrawer({ kind: 'purchase', id: p.id })}>{p.number}</button><small className="sub">{p.material}</small></td>
                <td>{p.project}</td>
                <td>{p.supplier}</td>
                <td className="r num">{rub(Number(p.receivedQuantity))} / {rub(Number(p.quantity))}</td>
                <td className="r num">{short(purchaseAmount(p))}</td>
                <td className={p.delayed ? 'is-over' : ''}>{date(p.dueAt)}{p.delayed && <small className="sub">просрочено</small>}</td>
                <td><Status status={p.delayed ? 'delayed' : p.status} label={p.delayed ? 'Просрочено' : undefined} /></td>
                <td><PurchaseAction p={p} /></td>
              </tr>))}</tbody>
          </table></div>
        ) : mode === 'table' ? <Cards list={list} picked={picked} toggle={toggle} /> : <Stages list={list} />}
      </Sheet>
    </div>
  );
}

const columns: { key: string; label: string; match: (p: Purchase) => boolean }[] = [
  { key: 'requested', label: 'Заявка', match: p => p.status === 'requested' },
  { key: 'ordered', label: 'Заказано', match: p => p.status === 'ordered' },
  { key: 'partial', label: 'Принято частично', match: p => p.status === 'partial' },
  { key: 'received', label: 'Принято', match: p => p.status === 'received' },
];

function Stages({ list }: { list: Purchase[] }) {
  const { openDrawer } = useErp();
  const rejected = list.filter(p => p.status === 'rejected');
  return (
    <>
      <div className="stages">
        {columns.map(c => {
          const items = list.filter(c.match);
          return (
            <section key={c.key} className="stage-col" aria-label={c.label}>
              <h3><Mark kind={metaOf(c.key).mark} size={13} />{c.label}<span className="chip-count">{items.length}</span></h3>
              {items.length === 0 ? <p className="muted small">Нет заявок на этом этапе.</p> : (
                <ul>{items.map(p => (
                  <li key={p.id} className="stage-card" data-late={p.delayed || undefined}>
                    <button className="link strong" onClick={() => openDrawer({ kind: 'purchase', id: p.id })}>{p.number} · {p.material}</button>
                    <span className="muted small">{p.project}</span>
                    <span className="num small">{rub(Number(p.receivedQuantity))} / {rub(Number(p.quantity))} · {short(purchaseAmount(p))}</span>
                    {p.dueAt && <span className={`small ${p.delayed ? 'is-over' : 'muted'}`}>{p.delayed && <Mark kind="behind" size={11} />} к {dateShort(p.dueAt)}{p.delayed ? ' — просрочено' : ''}</span>}
                    <PurchaseAction p={p} />
                  </li>
                ))}</ul>
              )}
            </section>
          );
        })}
      </div>
      {rejected.length > 0 && <p className="muted small">Отклонено: {rejected.map(p => p.number).join(', ')}. Отклонённые заявки в этапы не входят.</p>}
      <p className="muted small">Заявка переходит на следующий этап кнопкой в карточке. Согласование сразу создаёт заказ, поэтому отдельного этапа «Согласована» нет.</p>
    </>
  );
}

// На телефоне таблица заменена карточками: без горизонтальной прокрутки.
function Cards({ list, picked, toggle }: { list: Purchase[]; picked: Set<string>; toggle: (id: string) => void }) {
  const { openDrawer } = useErp();
  return (
    <ul className="cards">
      {list.map(p => (
        <li key={p.id} className="stage-card" data-late={p.delayed || undefined}>
          <label className="card-pick"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Выбрать заявку ${p.number}`} /><button type="button" className="link strong" onClick={() => openDrawer({ kind: 'purchase', id: p.id })}>{p.number} · {p.material}</button></label>
          <span className="muted small">{p.project} · {p.supplier}</span>
          <span className="num small">{rub(Number(p.receivedQuantity))} / {rub(Number(p.quantity))} · {short(purchaseAmount(p))}</span>
          <span className="small"><Status status={p.delayed ? 'delayed' : p.status} label={p.delayed ? 'Просрочено' : undefined} />{p.dueAt ? <span className="muted"> · к {dateShort(p.dueAt)}</span> : null}</span>
          <PurchaseAction p={p} />
        </li>
      ))}
    </ul>
  );
}
