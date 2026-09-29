'use client';
import { useState } from 'react';
import { useErp } from '../context';
import { useActions } from '../actions';
import { Empty, Sheet } from '../ui';
import { ScaleLegend, TripleScale } from '../triple-scale';
import { Mark } from '../marks';
import { date, exportCSV, money, short } from '../format';

export function MoneyView({ sub }: { sub: string }) {
  return sub === 'expenses' ? <Expenses /> : <Budget />;
}

function Budget() {
  const { data, scopeId, create, openProject } = useErp();
  const acts = useActions();
  const projects = data.projects.filter(p => !scopeId || p.id === scopeId);
  const max = Math.max(1, ...projects.flatMap(p => [p.budget, p.actual, p.forecast, Number(p.contractValue)]));
  const t = projects.reduce((n, p) => ({ plan: n.plan + p.budget, fact: n.fact + p.actual, fc: n.fc + p.forecast, contract: n.contract + Number(p.contractValue) }), { plan: 0, fact: 0, fc: 0, contract: 0 });
  return (
    <div className="page">
      <header className="page-head">
        <div><h1 className="disp">Деньги</h1><p className="muted">План, факт и прогноз затрат · договор с заказчиком отмечен засечкой</p></div>
        <div className="head-actions">{acts.canWrite && <><button className="btn" onClick={() => create('budget', scopeId ? { projectId: scopeId } : {})}>Добавить статью бюджета</button><button className="btn btn-mark" onClick={() => create('expense', scopeId ? { projectId: scopeId } : {})}>Внести расход</button></>}</div>
      </header>
      <Sheet title="Бюджет по объектам" aside={projects.length}>
        <div className="ledger"><span>Итого</span><span>план <b className="num">{short(t.plan)}</b></span><span>факт <b className="num">{short(t.fact)}</b></span><span>прогноз <b className={`num ${t.fc > t.plan ? 'is-over' : ''}`}>{short(t.fc)}</b></span><span>договоры <b className="num">{short(t.contract)}</b></span></div>
        {projects.length === 0 ? <Empty title="Объектов нет" hint="Создайте объект, чтобы вести бюджет." /> : (
          <>
            <ScaleLegend />
            <div className="scale-rows">
              {projects.map(p => (
                <div className="scale-row" key={p.id}>
                  <div className="scale-name"><button className="link strong" onClick={() => openProject(p.id)}>{p.name}</button><small className="num">{p.code}</small>{p.variance < 0 && <small className="is-over"><Mark kind="over" size={11} /> выше плана на {short(-p.variance)}</small>}</div>
                  <TripleScale plan={p.budget} fact={p.actual} forecast={p.forecast} limit={Number(p.contractValue)} limitLabel="договор" max={max} label={p.name} />
                </div>
              ))}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

function Expenses() {
  const { data, scopeId, create, openDrawer } = useErp();
  const acts = useActions();
  const [cat, setCat] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = data.expenses.filter(e => !scopeId || e.projectId === scopeId);
  const cats = Array.from(new Set(all.map(e => e.category)));
  const list = all.filter(e => !cat || e.category === cat);
  const total = list.reduce((n, e) => n + Number(e.amount), 0);
  return (
    <div className="page">
      <header className="page-head">
        <div><h1 className="disp">Расходы</h1><p className="muted">Фактические затраты · {all.length} записей</p></div>
        {acts.canWrite && <button className="btn btn-mark" onClick={() => create('expense', scopeId ? { projectId: scopeId } : {})}>Внести расход</button>}
      </header>
      <Sheet title="Журнал расходов" aside={list.length} actions={<>{picked.size > 0 && <button className="btn" onClick={() => exportCSV(list.filter(e => picked.has(e.id)), 'expenses-selected')}>Экспортировать выбранные ({picked.size})</button>}<button className="btn" onClick={() => exportCSV(list, 'expenses')}>Экспортировать всё</button></>}>
        <div className="chips" role="group" aria-label="Статья затрат">
          <button className="chip" aria-pressed={cat === ''} onClick={() => setCat('')}>Все статьи</button>
          {cats.map(c => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        {list.length === 0 ? <Empty title="Расходов нет" hint="Внесите первый расход." action={acts.canWrite ? 'Внести расход' : undefined} onAction={() => create('expense')} /> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl">
            <thead><tr><th className="chk"><input type="checkbox" aria-label="Выбрать все расходы" checked={picked.size === list.length} onChange={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map(e => e.id)))} /></th><th>Дата</th><th>Основание</th><th>Объект</th><th>Статья</th><th className="r">Сумма</th></tr></thead>
            <tbody>{list.map(e => (
              <tr key={e.id} data-picked={picked.has(e.id) || undefined}>
                <td className="chk"><input type="checkbox" aria-label={`Выбрать: ${e.description}`} checked={picked.has(e.id)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} /></td>
                <td>{date(e.incurredAt)}</td>
                <td><button className="link strong" onClick={() => openDrawer({ kind: 'expense', id: e.id })}>{e.description}</button></td>
                <td>{e.project}</td><td>{e.category}</td><td className="r num">{money(Number(e.amount))}</td>
              </tr>))}</tbody>
            <tfoot><tr><td colSpan={5}>Итого</td><td className="r num">{money(total)}</td></tr></tfoot>
          </table></div>
        )}
      </Sheet>
    </div>
  );
}
