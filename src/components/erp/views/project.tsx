'use client';
import { useState } from 'react';
import { ArrowLeft, MessageSquareText } from 'lucide-react';
import { useErp } from '../context';
import { useActions } from '../actions';
import { Stamp } from '../stamp';
import { Empty, Segmented, Sheet, Status } from '../ui';
import { ScaleLegend, TripleScale } from '../triple-scale';
import { Marginalia } from '../marginalia';
import { Mark } from '../marks';
import { WbsRibbon } from './wbs';
import { deviations, elapsedShare, lateDays, purchaseAmount, receivedAmount } from '../derive';
import { dateShort, date, days, exportCSV, money, short } from '../format';
import type { Project } from '../types';

type Mode = 'state' | 'work' | 'money';

export function ProjectView({ project }: { project: Project }) {
  const erp = useErp();
  const { openDrawer, create, setScope, go } = erp;
  const acts = useActions();
  const [mode, setMode] = useState<Mode>('state');

  return (
    <div className="page">
      <div className="crumbs">
        <button className="link" onClick={() => { setScope(''); go('projects', 'registry'); }}><ArrowLeft size={15} aria-hidden="true" /> Все объекты</button>
        <button className="btn margin-toggle" onClick={() => openDrawer({ kind: 'notes', id: project.id })}><MessageSquareText size={16} aria-hidden="true" />Замечания и изменения</button>
      </div>
      <Stamp project={project} />
      <div className="mode-bar">
        <Segmented<Mode> label="Режим объекта" value={mode} onChange={setMode} options={[{ value: 'state', label: 'Состояние' }, { value: 'work', label: 'Работа' }, { value: 'money', label: 'Деньги' }]} />
        {acts.canWrite && <div className="mode-actions"><button className="btn" onClick={() => create('task', { projectId: project.id })}>Создать работу</button><button className="btn" onClick={() => create('purchase', { projectId: project.id })}>Создать заявку</button><button className="btn" onClick={() => create('expense', { projectId: project.id })}>Внести расход</button></div>}
      </div>
      <div className="page-grid">
        <div className="page-main" role="tabpanel">
          {mode === 'state' && <StateMode project={project} />}
          {mode === 'work' && <Sheet title="Лента работ" actions={<span className="muted small">План — штриховка, факт — заливка</span>}><WbsRibbon project={project} /></Sheet>}
          {mode === 'money' && <MoneyMode project={project} />}
        </div>
        <div className="page-margin"><Marginalia projectId={project.id} /></div>
      </div>
    </div>
  );
}

function StateMode({ project: p }: { project: Project }) {
  const { data, today, openDrawer } = useErp();
  const dev = deviations(data, p, today);
  const buys = data.purchases.filter(x => x.projectId === p.id && x.status !== 'rejected');
  const planBuy = buys.reduce((n, x) => n + purchaseAmount(x), 0);
  const gotBuy = buys.reduce((n, x) => n + receivedAmount(x), 0);
  const expenses = data.expenses.filter(e => e.projectId === p.id);
  const overCats = data.budgets.filter(b => b.projectId === p.id).reduce<Record<string, number>>((m, b) => ({ ...m, [b.category]: (m[b.category] || 0) + Number(b.amount) }), {});
  const factCats = expenses.reduce<Record<string, number>>((m, e) => ({ ...m, [e.category]: (m[e.category] || 0) + Number(e.amount) }), {});
  const over = Object.keys(overCats).filter(c => (factCats[c] || 0) > overCats[c]);
  const shortMats = data.materials.filter(m => m.shortage && buys.some(x => x.materialId === m.id));

  type Issue = { key: string; mark: 'behind' | 'over' | 'wait'; tone: 'err' | 'warn'; text: string; sub: string; open: () => void };
  const issues: Issue[] = [
    ...dev.lateTasks.map(t => ({ key: 't' + t.id, mark: 'behind' as const, tone: 'err' as const, text: `${t.name}: позже срока на ${days(lateDays(t, today))}`, sub: `готовность ${t.progress}%`, open: () => openDrawer({ kind: 'task', id: t.id }) })),
    ...dev.latePurchases.map(x => ({ key: 'p' + x.id, mark: 'behind' as const, tone: 'err' as const, text: `Поставка ${x.number} просрочена`, sub: `${x.material}, принято ${Number(x.receivedQuantity)} из ${Number(x.quantity)}`, open: () => openDrawer({ kind: 'purchase', id: x.id }) })),
    ...over.map(c => ({ key: 'c' + c, mark: 'over' as const, tone: 'err' as const, text: `Статья «${c}»: факт выше плана`, sub: `план ${short(overCats[c])}, факт ${short(factCats[c])}`, open: () => undefined })),
    ...dev.pending.map(x => ({ key: 'r' + x.id, mark: 'wait' as const, tone: 'warn' as const, text: `Заявка ${x.number} ждёт согласования`, sub: `${x.material}, ${short(purchaseAmount(x))}`, open: () => openDrawer({ kind: 'purchase', id: x.id }) })),
    ...shortMats.map(m => ({ key: 'm' + m.id, mark: 'over' as const, tone: 'err' as const, text: `${m.name}: остаток ниже минимума`, sub: `на складе ${m.balance} ${m.unit}`, open: () => openDrawer({ kind: 'material', id: m.id }) })),
  ];

  return (
    <>
      <Sheet title="План, факт, прогноз">
        <ScaleLegend />
        <div className="scale-rows">
          <div className="scale-row"><div className="scale-name">Бюджет</div><TripleScale plan={p.budget} fact={p.actual} forecast={p.forecast} limit={Number(p.contractValue)} limitLabel="договор" label="Бюджет" /></div>
          <div className="scale-row"><div className="scale-name">Срок<small>прошло времени и готовность</small></div><TripleScale plan={elapsedShare(p.startDate, p.endDate, today)} fact={p.progress} max={100} format={n => `${Math.round(n)}%`} label="Срок" /></div>
          <div className="scale-row"><div className="scale-name">Снабжение<small>заказано и принято</small></div><TripleScale plan={planBuy} fact={gotBuy} label="Снабжение" /></div>
        </div>
      </Sheet>
      <Sheet title="Отклонения и открытые вопросы" aside={issues.length}>
        {issues.length === 0 ? <Empty title="Отклонений нет" hint="Сроки, бюджет и снабжение по объекту в норме." /> : (
          <ul className="issues">
            {issues.map(i => <li key={i.key}><button type="button" onClick={i.open}><span data-tone={i.tone} className="issue-mark"><Mark kind={i.mark} size={16} /></span><span><b>{i.text}</b><small>{i.sub}</small></span></button></li>)}
          </ul>
        )}
      </Sheet>
      <Sheet title="Паспорт объекта">
        <dl className="kv kv-wide">
          <div><dt>Договор с заказчиком</dt><dd className="num">{money(Number(p.contractValue))}</dd></div>
          <div><dt>Начало</dt><dd>{date(p.startDate)}</dd></div>
          <div><dt>Плановое окончание</dt><dd>{date(p.endDate)}</dd></div>
          <div><dt>Стадия</dt><dd><Status status={p.status} /></dd></div>
        </dl>
      </Sheet>
    </>
  );
}

function MoneyMode({ project: p }: { project: Project }) {
  const { data, create, openDrawer } = useErp();
  const acts = useActions();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lines = data.budgets.filter(b => b.projectId === p.id);
  const expenses = data.expenses.filter(e => e.projectId === p.id);
  const cats = Array.from(new Set([...lines.map(b => b.category), ...expenses.map(e => e.category)]));
  const rows = cats.map(c => ({ c, plan: lines.filter(b => b.category === c).reduce((n, b) => n + Number(b.amount), 0), fact: expenses.filter(e => e.category === c).reduce((n, e) => n + Number(e.amount), 0) }));
  const max = Math.max(1, ...rows.flatMap(r => [r.plan, r.fact]));
  const contracts = data.contracts.filter(c => c.projectId === p.id);
  const toggleAll = () => setPicked(picked.size === expenses.length ? new Set() : new Set(expenses.map(e => e.id)));

  return (
    <>
      <Sheet title="Бюджет по статьям" actions={acts.canWrite ? <button className="btn" onClick={() => create('budget', { projectId: p.id })}>Добавить статью</button> : undefined}>
        {rows.length === 0 ? <Empty title="Статей бюджета нет" hint="Добавьте плановую сумму по статье, чтобы сравнивать её с фактом." action={acts.canWrite ? 'Добавить статью' : undefined} onAction={() => create('budget', { projectId: p.id })} /> : (
          <>
            <ScaleLegend limit={false} />
            <div className="scale-rows">
              {rows.map(r => (
                <div className="scale-row" key={r.c}>
                  <div className="scale-name">{r.fact > r.plan && <span data-tone="err" className="inline-mark"><Mark kind="over" size={13} /></span>}{r.c}{r.plan === 0 && <small>плана нет</small>}</div>
                  <TripleScale plan={r.plan} fact={r.fact} max={max} label={r.c} size="sm" />
                </div>
              ))}
            </div>
          </>
        )}
      </Sheet>
      <Sheet title="Расходы" aside={expenses.length} actions={<>
        {picked.size > 0 && <button className="btn" onClick={() => exportCSV(expenses.filter(e => picked.has(e.id)), 'expenses-selected')}>Экспортировать выбранные ({picked.size})</button>}
        {acts.canWrite && <button className="btn" onClick={() => create('expense', { projectId: p.id })}>Внести расход</button>}
      </>}>
        {expenses.length === 0 ? <Empty title="Расходов пока нет" hint="Внесите первый расход по объекту." action={acts.canWrite ? 'Внести расход' : undefined} onAction={() => create('expense', { projectId: p.id })} /> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl">
            <thead><tr><th className="chk"><input type="checkbox" aria-label="Выбрать все расходы" checked={picked.size === expenses.length} onChange={toggleAll} /></th><th>Дата</th><th>Основание</th><th>Статья</th><th>Работа</th><th className="r">Сумма</th></tr></thead>
            <tbody>{expenses.map(e => (
              <tr key={e.id} data-picked={picked.has(e.id) || undefined}>
                <td className="chk"><input type="checkbox" aria-label={`Выбрать: ${e.description}`} checked={picked.has(e.id)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} /></td>
                <td>{dateShort(e.incurredAt)}</td>
                <td><button className="link strong" onClick={() => openDrawer({ kind: 'expense', id: e.id })}>{e.description}</button></td>
                <td>{e.category}</td>
                <td className="muted">{data.tasks.find(t => t.id === e.taskId)?.name || 'Не привязан'}</td>
                <td className="r num">{money(Number(e.amount))}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Sheet>
      <Sheet title="Договоры" aside={contracts.length} actions={acts.canWrite ? <button className="btn" onClick={() => create('contract', { projectId: p.id })}>Создать договор</button> : undefined}>
        {contracts.length === 0 ? <Empty title="Договоров нет" hint="Создайте договор с поставщиком или подрядчиком." /> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl"><thead><tr><th>Номер</th><th>Контрагент</th><th>Вид</th><th>Статус</th><th className="r">Сумма</th></tr></thead>
            <tbody>{contracts.map(c => <tr key={c.id}><td><button className="link strong" onClick={() => openDrawer({ kind: 'contract', id: c.id })}>{c.number}</button></td><td>{data.counterparties.find(x => x.id === c.counterpartyId)?.name || '—'}</td><td>{c.kind}</td><td><Status status={c.status} /></td><td className="r num">{money(Number(c.amount))}</td></tr>)}</tbody></table></div>
        )}
      </Sheet>
    </>
  );
}
