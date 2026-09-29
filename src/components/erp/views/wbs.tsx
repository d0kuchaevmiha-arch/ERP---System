'use client';
import { useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useErp } from '../context';
import { useActions } from '../actions';
import { Mark } from '../marks';
import { Status } from '../ui';
import { TripleScale } from '../triple-scale';
import { PurchaseAction } from '../parts';
import { elapsedShare, lateDays, purchaseAmount } from '../derive';
import { dateShort, days, isIncoming, metaOf, money, movementLabel, rub, short, taskKindLabel } from '../format';
import type { Project, Task } from '../types';

type Filter = 'all' | 'purchases' | 'materials' | 'expenses' | 'contracts';
export const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Всё' }, { value: 'purchases', label: 'Закупки' }, { value: 'materials', label: 'Материалы' }, { value: 'expenses', label: 'Расходы' }, { value: 'contracts', label: 'Договоры' },
];

type Row =
  | { key: string; level: number; type: 'task'; task: Task; hasKids: boolean }
  | { key: string; level: number; type: 'purchase' | 'expense' | 'movement' | 'contract' | 'budget'; id: string }
  | { key: string; level: number; type: 'group'; label: string; count: number };

// WBS-лента: этап → работа → расходы и движения материалов; закупки и договоры привязаны только к объекту.
export function WbsRibbon({ project }: { project: Project }) {
  const erp = useErp();
  const { data, today, openDrawer } = erp;
  const acts = useActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  const tasks = useMemo(() => data.tasks.filter(t => t.projectId === project.id), [data.tasks, project.id]);
  const byParent = useMemo(() => {
    const ids = new Set(tasks.map(t => t.id));
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.parentId && ids.has(t.parentId) ? t.parentId : '';
      m.set(k, [...(m.get(k) || []), t]);
    }
    for (const list of m.values()) list.sort((a, b) => (a.code || '').localeCompare(b.code || '', 'ru', { numeric: true }) || (a.startDate || '').localeCompare(b.startDate || ''));
    return m;
  }, [tasks]);

  const expenses = data.expenses.filter(e => e.projectId === project.id);
  const moves = data.movements.filter(m => m.projectId === project.id);
  const purchases = data.purchases.filter(p => p.projectId === project.id);
  const contracts = data.contracts.filter(c => c.projectId === project.id);
  const budgets = data.budgets.filter(b => b.projectId === project.id);

  const show = (kind: 'purchases' | 'materials' | 'expenses' | 'contracts') => filter === 'all' || filter === kind;
  const attached = (t: Task) => ({
    expenses: show('expenses') ? expenses.filter(e => e.taskId === t.id) : [],
    moves: show('materials') ? moves.filter(m => m.taskId === t.id) : [],
    budgets: filter === 'all' ? budgets.filter(b => b.taskId === t.id) : [],
  });
  const hasAttached = (t: Task): boolean => { const a = attached(t); return a.expenses.length + a.moves.length + a.budgets.length > 0 || (byParent.get(t.id) || []).some(hasAttached); };

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (t: Task, level: number) => {
      if (filter !== 'all' && !hasAttached(t)) return;
      const kids = byParent.get(t.id) || [];
      const a = attached(t);
      const hasKids = kids.length + a.expenses.length + a.moves.length + a.budgets.length > 0;
      out.push({ key: 't' + t.id, level, type: 'task', task: t, hasKids });
      if (!closed.has(t.id)) {
        a.budgets.forEach(b => out.push({ key: 'b' + b.id, level: level + 1, type: 'budget', id: b.id }));
        a.expenses.forEach(e => out.push({ key: 'e' + e.id, level: level + 1, type: 'expense', id: e.id }));
        a.moves.forEach(m => out.push({ key: 'm' + m.id, level: level + 1, type: 'movement', id: m.id }));
        kids.forEach(k => walk(k, level + 1));
      }
    };
    (byParent.get('') || []).forEach(t => walk(t, 1));
    const loose = {
      purchases: show('purchases') ? purchases : [],
      expenses: show('expenses') ? expenses.filter(e => !e.taskId) : [],
      moves: show('materials') ? moves.filter(m => !m.taskId) : [],
      contracts: show('contracts') ? contracts : [],
    };
    const count = loose.purchases.length + loose.expenses.length + loose.moves.length + loose.contracts.length;
    if (count > 0) {
      out.push({ key: 'g-loose', level: 1, type: 'group', label: 'Без привязки к этапу', count });
      if (!closed.has('g-loose')) {
        loose.purchases.forEach(p => out.push({ key: 'p' + p.id, level: 2, type: 'purchase', id: p.id }));
        loose.moves.forEach(m => out.push({ key: 'm' + m.id, level: 2, type: 'movement', id: m.id }));
        loose.expenses.forEach(e => out.push({ key: 'e' + e.id, level: 2, type: 'expense', id: e.id }));
        loose.contracts.forEach(c => out.push({ key: 'c' + c.id, level: 2, type: 'contract', id: c.id }));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byParent, filter, closed, expenses.length, moves.length, purchases.length, contracts.length, budgets.length, data]);

  const activeKey = rows.some(r => r.key === focusKey) ? focusKey : rows[0]?.key || '';
  const focusRow = (key: string) => { setFocusKey(key); requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus()); };
  const toggle = (id: string) => setClosed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function open(row: Row) {
    if (row.type === 'task') openDrawer({ kind: 'task', id: row.task.id });
    else if (row.type === 'group') toggle('g-loose');
    else if (row.type === 'budget') openDrawer({ kind: 'project', id: project.id });
    else if (row.type === 'movement') { const m = data.movements.find(x => x.id === row.id); if (m) openDrawer({ kind: 'material', id: m.materialId }); }
    else openDrawer({ kind: row.type, id: row.id });
  }

  function onKey(e: React.KeyboardEvent) {
    const i = rows.findIndex(r => r.key === activeKey);
    if (i < 0) return;
    const row = rows[i];
    const id = row.type === 'task' ? row.task.id : row.type === 'group' ? 'g-loose' : '';
    const expandable = row.type === 'group' || (row.type === 'task' && row.hasKids);
    if (e.key === 'ArrowDown') { e.preventDefault(); if (rows[i + 1]) focusRow(rows[i + 1].key); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (rows[i - 1]) focusRow(rows[i - 1].key); }
    else if (e.key === 'Home') { e.preventDefault(); focusRow(rows[0].key); }
    else if (e.key === 'End') { e.preventDefault(); focusRow(rows[rows.length - 1].key); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (expandable && closed.has(id)) toggle(id); else if (rows[i + 1] && rows[i + 1].level > row.level) focusRow(rows[i + 1].key); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (expandable && !closed.has(id)) toggle(id);
      else { for (let j = i - 1; j >= 0; j--) if (rows[j].level < row.level) { focusRow(rows[j].key); break; } }
    } else if (e.key === 'Enter') { e.preventDefault(); open(row); }
  }

  const counts: Record<Filter, number> = { all: 0, purchases: purchases.length, materials: moves.length, expenses: expenses.length, contracts: contracts.length };

  return (
    <div>
      <div className="chips" role="group" aria-label="Что показывать в ленте">
        {filters.map(f => <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value} onClick={() => { setFilter(f.value); setFocusKey(''); }}>{f.label}{f.value !== 'all' && <span className="chip-count">{counts[f.value]}</span>}</button>)}
      </div>
      {rows.length === 0 ? (
        <div className="empty"><b>{filter === 'all' ? 'Работ пока нет' : 'Записей этого типа нет'}</b><span>{filter === 'all' ? 'Добавьте этап, чтобы связать с ним расходы и материалы.' : 'Выберите «Всё» или другой тип записей.'}</span>{acts.canWrite && filter === 'all' && <button className="btn" onClick={() => erp.create('task', { projectId: project.id, kind: 'stage' })}>Создать этап</button>}</div>
      ) : (
        <ul className="wbs" role="tree" aria-label="Лента работ объекта" ref={listRef} onKeyDown={onKey}>
          {rows.map((r, idx) => {
            const expandable = r.type === 'group' || (r.type === 'task' && r.hasKids);
            const id = r.type === 'task' ? r.task.id : r.type === 'group' ? 'g-loose' : '';
            const isOpen = expandable ? !closed.has(id) : undefined;
            return (
              <li key={r.key} role="treeitem" aria-level={r.level} aria-posinset={idx + 1} aria-setsize={rows.length} aria-expanded={isOpen} aria-selected={activeKey === r.key} tabIndex={activeKey === r.key ? 0 : -1} data-key={r.key} data-type={r.type} className="wbs-row" style={{ ['--lvl' as string]: r.level - 1 }} onFocus={() => setFocusKey(r.key)} onClick={() => open(r)}>
                <span className="wbs-chevron">
                  {expandable && <button type="button" tabIndex={-1} className="chev" data-open={isOpen} aria-label={isOpen ? 'Свернуть' : 'Развернуть'} onClick={e => { e.stopPropagation(); toggle(id); }}><ChevronRight size={16} /></button>}
                </span>
                <RowBody row={r} today={today} project={project} />
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small wbs-note">Заявки на материалы в системе привязаны к объекту, а не к этапу, поэтому показаны в группе «Без привязки к этапу». Расходы и движения материалов можно привязать к работе при внесении.</p>
    </div>
  );
}

function RowBody({ row, today, project }: { row: Row; today: string; project: Project }) {
  const { data, openDrawer } = useErp();
  const acts = useActions();
  if (row.type === 'group') return <><span className="wbs-code" /><span className="wbs-main"><b>{row.label}</b><span className="muted small">{row.count} зап.</span></span><span className="wbs-scale" /><span className="wbs-val" /><span className="wbs-act" /></>;
  if (row.type === 'task') {
    const t = row.task;
    const late = t.delayed ? lateDays(t, today) : 0;
    return <>
      <span className="wbs-code num">{t.code || '·'}</span>
      <span className="wbs-main"><b>{t.name}</b><span className="muted small">{taskKindLabel[t.kind] || t.kind} · {dateShort(t.startDate)} — {dateShort(t.endDate)}{late > 0 ? ` · позже срока на ${days(late)}` : ''}</span></span>
      <span className="wbs-scale"><TripleScale plan={elapsedShare(t.startDate, t.endDate, today)} fact={t.progress} max={100} format={n => `${Math.round(n)}%`} label={`Готовность: ${t.name}`} values={false} size="sm" /></span>
      <span className="wbs-val num">{t.progress}%</span>
      <span className="wbs-act">{t.delayed ? <Status status="delayed" /> : <Status status={t.status} />}{acts.canWrite && t.progress < 100 && <button type="button" className="btn" onClick={e => { e.stopPropagation(); openDrawer({ kind: 'task', id: t.id }); }}>Внести</button>}</span>
    </>;
  }
  if (row.type === 'purchase') {
    const p = data.purchases.find(x => x.id === row.id); if (!p) return null;
    const m = metaOf(p.delayed ? 'delayed' : p.status);
    return <>
      <span className="wbs-code"><Mark kind={m.mark} size={14} /></span>
      <span className="wbs-main"><b>{p.number} · {p.material}</b><span className="muted small">{p.supplier} · {rub(Number(p.receivedQuantity))} из {rub(Number(p.quantity))}{p.dueAt ? ` · к ${dateShort(p.dueAt)}` : ''}</span></span>
      <span className="wbs-scale"><TripleScale plan={purchaseAmount(p)} fact={Number(p.receivedQuantity) * Number(p.unitPrice)} label={`Поставка ${p.number}`} values={false} size="sm" /></span>
      <span className="wbs-val num">{short(purchaseAmount(p))}</span>
      <span className="wbs-act"><Status status={p.delayed ? 'delayed' : p.status} label={p.delayed ? 'Просрочено' : undefined} /><PurchaseAction p={p} /></span>
    </>;
  }
  if (row.type === 'expense') {
    const e = data.expenses.find(x => x.id === row.id); if (!e) return null;
    return <><span className="wbs-code muted small">расход</span><span className="wbs-main"><b>{e.description}</b><span className="muted small">{e.category} · {dateShort(e.incurredAt)}</span></span><span className="wbs-scale" /><span className="wbs-val num">{money(Number(e.amount))}</span><span className="wbs-act" /></>;
  }
  if (row.type === 'movement') {
    const m = data.movements.find(x => x.id === row.id); if (!m) return null;
    const mat = data.materials.find(x => x.id === m.materialId);
    return <><span className="wbs-code muted small">склад</span><span className="wbs-main"><b>{movementLabel[m.type] || m.type}: {mat?.name}</b><span className="muted small">{m.note || '—'}</span></span><span className="wbs-scale" /><span className="wbs-val num">{isIncoming(m.type) ? '+' : '−'}{rub(Number(m.quantity))} {mat?.unit}</span><span className="wbs-act" /></>;
  }
  if (row.type === 'contract') {
    const c = data.contracts.find(x => x.id === row.id); if (!c) return null;
    return <><span className="wbs-code muted small">договор</span><span className="wbs-main"><b>{c.number}</b><span className="muted small">{data.counterparties.find(p => p.id === c.counterpartyId)?.name || '—'} · {c.kind}</span></span><span className="wbs-scale" /><span className="wbs-val num">{short(Number(c.amount))}</span><span className="wbs-act"><Status status={c.status} /></span></>;
  }
  const b = data.budgets.find(x => x.id === row.id); if (!b) return null;
  return <><span className="wbs-code muted small">план</span><span className="wbs-main"><b>Бюджет: {b.category}</b><span className="muted small">{b.period || 'весь период'} · {project.code}</span></span><span className="wbs-scale" /><span className="wbs-val num">{short(Number(b.amount))}</span><span className="wbs-act" /></>;
}
