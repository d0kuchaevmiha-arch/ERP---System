'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useErp } from './context';
import { useActions } from './actions';
import { ConfirmButton, Status } from './ui';
import { TripleScale } from './triple-scale';
import { Marginalia, describeAudit } from './marginalia';
import { StockRuler } from './stock-ruler';
import { date, days, money, movementLabel, partyKindLabel, rub, short, taskKindLabel, isIncoming } from './format';
import { elapsedShare, lateDays, purchaseAmount, receivedAmount } from './derive';
import { ClientTime } from './ui';
import type { Data, DrawerRef } from './types';

function drawerTitle(data: Data, t: NonNullable<DrawerRef>): string {
  switch (t.kind) {
    case 'notes': return 'Замечания и изменения';
    case 'project': return data.projects.find(x => x.id === t.id)?.name || 'Объект';
    case 'task': return data.tasks.find(x => x.id === t.id)?.name || 'Работа';
    case 'purchase': { const p = data.purchases.find(x => x.id === t.id); return p ? `Заявка ${p.number}` : 'Заявка'; }
    case 'material': return data.materials.find(x => x.id === t.id)?.name || 'Материал';
    case 'expense': return data.expenses.find(x => x.id === t.id)?.description || 'Расход';
    case 'contract': { const c = data.contracts.find(x => x.id === t.id); return c ? `Договор ${c.number}` : 'Договор'; }
    case 'counterparty': return data.counterparties.find(x => x.id === t.id)?.name || 'Контрагент';
  }
}

function Rows({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Drawer({ target }: { target: NonNullable<DrawerRef> }) {
  const { closeDrawer } = useErp();
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();
  const { data } = useErp();
  const title = drawerTitle(data, target);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-close]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [closeDrawer]);

  return (
    <>
      <div className="scrim" onClick={closeDrawer} />
      <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={uid} data-open>
        <div className="drawer-head">
          <h2 id={uid} className="disp">{title}</h2>
          <button type="button" className="icon-btn" data-close onClick={closeDrawer} aria-label="Закрыть панель"><X size={18} /></button>
        </div>
        <div className="drawer-body"><DrawerBody target={target} /></div>
      </div>
    </>
  );
}

function DrawerBody({ target }: { target: NonNullable<DrawerRef> }) {
  const erp = useErp();
  const { data, today } = erp;
  const acts = useActions();
  const t = data.tasks.find(x => x.id === target.id);
  const seed = `${target.id}:${t?.progress ?? 0}`;
  const [seenSeed, setSeenSeed] = useState(seed);
  const [pct, setPct] = useState(String(t?.progress ?? 0));
  if (seenSeed !== seed) { setSeenSeed(seed); setPct(String(t?.progress ?? 0)); }
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);

  const audit = data.audit.filter(a => a.entityId === target.id).slice(0, 8);
  const history = audit.length > 0 && (
    <section className="drawer-sec">
      <h3>История изменений</h3>
      <ol className="margin-list">{audit.map(a => { const d = describeAudit(data, a); return <li key={a.id}><div className="static"><span className="margin-time"><ClientTime value={a.createdAt} /></span><span className="margin-text"><b>{d.action}</b></span><span className="margin-who">{d.who}</span></div></li>; })}</ol>
    </section>
  );

  switch (target.kind) {
    case 'notes': { return <Marginalia projectId={target.id || undefined} limit={30} />; }
    case 'project': {
      const p = data.projects.find(x => x.id === target.id);
      if (!p) return <p>Запись не найдена. Возможно, она удалена или у вас нет доступа.</p>;
      return <>
        <Rows items={[['Шифр', <span className="num" key="c">{p.code}</span>], ['Адрес', p.address || '—'], ['Руководитель', p.manager], ['Заказчик', p.customer], ['Готовность', `${p.progress}%`], ['Срок', `${date(p.startDate)} — ${date(p.endDate)}`]]} />
        <section className="drawer-sec"><h3>Бюджет</h3><TripleScale plan={p.budget} fact={p.actual} forecast={p.forecast} limit={Number(p.contractValue)} limitLabel="договор" label="Бюджет" /></section>
        <div className="drawer-actions"><button className="btn btn-mark" onClick={() => { erp.closeDrawer(); erp.openProject(p.id); }}>Открыть объект</button></div>
        {history}
      </>;
    }
    case 'task': {
      if (!t) return <p>Запись не найдена.</p>;
      const spent = data.expenses.filter(e => e.taskId === t.id);
      const moves = data.movements.filter(m => m.taskId === t.id);
      const late = t.delayed ? lateDays(t, today) : 0;
      const value = Math.min(100, Math.max(0, Number(pct) || 0));
      return <>
        <div className="drawer-status"><Status status={t.delayed ? 'delayed' : t.status} />{late > 0 && <span className="muted">на {days(late)} позже срока</span>}</div>
        <Rows items={[['Код', <span className="num" key="c">{t.code || '—'}</span>], ['Тип', taskKindLabel[t.kind] || t.kind], ['Объект', t.project], ['Срок', `${date(t.startDate)} — ${date(t.endDate)}`], ['Выполнено', `${rub(Number(t.actualQuantity))} ${t.unit}`]]} />
        <section className="drawer-sec">
          <h3>Готовность</h3>
          <TripleScale plan={elapsedShare(t.startDate, t.endDate, today)} fact={t.progress} max={100} format={n => `${Math.round(n)}%`} label="Готовность к сроку" size="sm" />
          {acts.canWrite ? (
            <form className="inline-form" onSubmit={async e => { e.preventDefault(); setBusy(true); await acts.setProgress(t, value, qty ? Number(qty) : undefined); setBusy(false); }}>
              <div className="chips" role="group" aria-label="Быстрый выбор готовности">{[0, 25, 50, 75, 100].map(n => <button type="button" key={n} className="chip" aria-pressed={value === n} onClick={() => setPct(String(n))}>{n}%</button>)}</div>
              <div className="field-row">
                <div className="field"><label htmlFor="d-pct">Готовность, %</label><input id="d-pct" type="number" min={0} max={100} inputMode="numeric" value={pct} onChange={e => setPct(e.target.value)} /></div>
                <div className="field"><label htmlFor="d-qty">Объём, {t.unit}</label><input id="d-qty" type="number" min={0} step="any" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder={String(Number(t.actualQuantity))} /></div>
              </div>
              <button className="btn btn-mark" disabled={busy}>{busy ? 'Вносим…' : 'Внести выполнение'}</button>
            </form>
          ) : <p className="muted small">Изменение готовности недоступно для вашей роли.</p>}
        </section>
        <section className="drawer-sec">
          <h3>Затраты на работу</h3>
          {t.plannedCost && Number(t.plannedCost) > 0 ? <TripleScale plan={Number(t.plannedCost)} fact={spent.reduce((n, e) => n + Number(e.amount), 0)} label="Затраты" size="sm" /> : <p className="muted small">Плановая стоимость не задана.</p>}
          {spent.length > 0 && <ul className="plain-list">{spent.map(e => <li key={e.id}><button type="button" onClick={() => erp.openDrawer({ kind: 'expense', id: e.id })}><span>{e.description}</span><b className="num">{money(Number(e.amount))}</b></button></li>)}</ul>}
          {moves.length > 0 && <ul className="plain-list">{moves.map(m => { const mat = data.materials.find(x => x.id === m.materialId); return <li key={m.id}><div className="static"><span>{movementLabel[m.type] || m.type}: {mat?.name}</span><b className="num">{isIncoming(m.type) ? '+' : '−'}{rub(Number(m.quantity))} {mat?.unit}</b></div></li>; })}</ul>}
          {acts.canWrite && <button className="btn" onClick={() => { erp.closeDrawer(); erp.create('expense', { projectId: t.projectId, taskId: t.id }); }}>Внести расход на работу</button>}
        </section>
        {history}
      </>;
    }
    case 'purchase': {
      const p = data.purchases.find(x => x.id === target.id);
      if (!p) return <p>Запись не найдена.</p>;
      const rest = Number(p.quantity) - Number(p.receivedQuantity);
      const mat = data.materials.find(m => m.id === p.materialId);
      return <>
        <div className="drawer-status"><Status status={p.delayed ? 'delayed' : p.status} label={p.delayed ? 'Поставка просрочена' : undefined} /></div>
        <Rows items={[['Материал', p.material], ['Объект', p.project], ['Поставщик', p.supplier], ['Нужно к', date(p.dueAt)], ['Количество', `${rub(Number(p.receivedQuantity))} из ${rub(Number(p.quantity))} ${mat?.unit || ''}`], ['Цена', money(Number(p.unitPrice))], ['Комментарий', p.note || '—']]} />
        <section className="drawer-sec"><h3>Снабжение</h3><TripleScale plan={purchaseAmount(p)} fact={receivedAmount(p)} label="Заказано и принято" size="sm" /></section>
        <div className="drawer-actions">
          {p.status === 'requested' && acts.canDecide && !acts.canApprove && <p className="muted small">Согласование — только при связи с сервером.</p>}
          {p.status === 'requested' && acts.canApprove && <>
            <ConfirmButton label="Согласовать заявку" confirmLabel="Да, согласовать" onConfirm={async () => { if (await acts.approve(p.id)) erp.closeDrawer(); }} />
            <ConfirmButton tone="plain" label="Отклонить" confirmLabel="Да, отклонить" onConfirm={async () => { if (await acts.approve(p.id, 'reject')) erp.closeDrawer(); }} />
          </>}
          {['ordered', 'partial'].includes(p.status) && acts.canDecide && <ConfirmButton label={`Принять остаток: ${rub(rest)} ${mat?.unit || ''}`} confirmLabel="Да, принять" onConfirm={async () => { if (await acts.receiveRest(p)) erp.closeDrawer(); }} />}
          {p.status === 'requested' && !acts.canDecide && <p className="muted small">Согласовать заявку могут директор, руководитель проекта и снабженец.</p>}
        </div>
        {history}
      </>;
    }
    case 'material': {
      const m = data.materials.find(x => x.id === target.id);
      if (!m) return <p>Запись не найдена.</p>;
      const moves = data.movements.filter(x => x.materialId === m.id).slice(0, 6);
      return <>
        <div className="drawer-status">{m.shortage ? <Status status="risk" label="Ниже неснижаемого остатка" /> : <Status status="completed" label="В норме" />}</div>
        <Rows items={[['Артикул', <span className="num" key="s">{m.sku}</span>], ['Категория', m.category || '—'], ['Цена', money(Number(m.price))]]} />
        <section className="drawer-sec"><h3>Остаток</h3><StockRuler balance={m.balance} min={Number(m.minStock)} unit={m.unit} /></section>
        <div className="drawer-actions">
          {acts.canWrite && <><button className="btn btn-mark" onClick={() => { erp.closeDrawer(); erp.create('purchase', { materialId: m.id, unitPrice: String(Number(m.price) || '') }); }}>Создать заявку</button><button className="btn" onClick={() => { erp.closeDrawer(); erp.create('movement', { materialId: m.id }); }}>Внести движение</button></>}
        </div>
        {moves.length > 0 && <section className="drawer-sec"><h3>Последние движения</h3><ul className="plain-list">{moves.map(x => <li key={x.id}><div className="static"><span>{movementLabel[x.type] || x.type}</span><b className="num">{isIncoming(x.type) ? '+' : '−'}{rub(Number(x.quantity))} {m.unit}</b></div></li>)}</ul></section>}
      </>;
    }
    case 'expense': {
      const e = data.expenses.find(x => x.id === target.id);
      if (!e) return <p>Запись не найдена.</p>;
      const task = data.tasks.find(x => x.id === e.taskId);
      const contract = data.contracts.find(x => x.id === e.contractId);
      return <>
        <Rows items={[['Сумма', <b className="num" key="a">{money(Number(e.amount))}</b>], ['Статья', e.category], ['Дата', date(e.incurredAt)], ['Объект', e.project], ['Этап или работа', task ? <button key="t" className="link" onClick={() => erp.openDrawer({ kind: 'task', id: task.id })}>{task.name}</button> : 'Не привязан'], ['Договор', contract ? contract.number : '—']]} />
        {history}
      </>;
    }
    case 'contract': {
      const c = data.contracts.find(x => x.id === target.id);
      if (!c) return <p>Запись не найдена.</p>;
      const party = data.counterparties.find(x => x.id === c.counterpartyId);
      return <>
        <div className="drawer-status"><Status status={c.status} /></div>
        <Rows items={[['Контрагент', party?.name || '—'], ['Вид', c.kind], ['Сумма', <b className="num" key="a">{money(Number(c.amount))}</b>], ['Объект', data.projects.find(p => p.id === c.projectId)?.name || '—'], ['Подписан', date(c.signedAt)], ['Срок до', date(c.dueAt)]]} />
        {history}
      </>;
    }
    case 'counterparty': {
      const c = data.counterparties.find(x => x.id === target.id);
      if (!c) return <p>Запись не найдена.</p>;
      const cs = data.contracts.filter(x => x.counterpartyId === c.id);
      return <>
        <Rows items={[['Тип', partyKindLabel[c.kind] || c.kind], ['ИНН', <span className="num" key="i">{c.inn || '—'}</span>], ['Контакт', c.contact || '—']]} />
        {cs.length > 0 && <section className="drawer-sec"><h3>Договоры</h3><ul className="plain-list">{cs.map(x => <li key={x.id}><button type="button" onClick={() => erp.openDrawer({ kind: 'contract', id: x.id })}><span>{x.number}</span><b className="num">{short(Number(x.amount))}</b></button></li>)}</ul></section>}
      </>;
    }
  }
}
