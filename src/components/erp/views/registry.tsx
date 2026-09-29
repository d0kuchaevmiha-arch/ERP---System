'use client';
import { useErp } from '../context';
import { useActions } from '../actions';
import { deviations, elapsedShare } from '../derive';
import { Mark } from '../marks';
import { Empty, Segmented, Sheet, Status, useStored } from '../ui';
import { ScaleLegend, TripleScale } from '../triple-scale';
import { short } from '../format';
import type { Project } from '../types';

// Реестр объектов: «Ленты» — строка со штампом-мини и шкалами на общем масштабе; «Список» — таблица.
export function Registry({ projects }: { projects: Project[] }) {
  const erp = useErp();
  const { data, today, create, openProject } = erp;
  const acts = useActions();
  const [mode, setMode] = useStored<'ribbons' | 'list'>('erp.registry', 'ribbons', ['ribbons', 'list']);
  const max = Math.max(1, ...projects.flatMap(p => [p.budget, p.actual, p.forecast, Number(p.contractValue)]));
  const totals = projects.reduce((t, p) => ({ plan: t.plan + p.budget, fact: t.fact + p.actual, fc: t.fc + p.forecast }), { plan: 0, fact: 0, fc: 0 });
  return (
          <Sheet
            title="Реестр объектов"
            aside={projects.length}
            actions={<>
              <Segmented label="Вид реестра" value={mode} onChange={setMode} options={[{ value: 'ribbons', label: 'Ленты' }, { value: 'list', label: 'Список' }]} />
              {acts.canWrite && <button className="btn" onClick={() => create('project')}>Создать объект</button>}
            </>}
          >
            <div className="ledger" aria-label="Итого по выбранным объектам">
              <span>Итого</span><span>план <b className="num">{short(totals.plan)}</b></span><span>факт <b className="num">{short(totals.fact)}</b></span><span>прогноз <b className={`num ${totals.fc > totals.plan ? 'is-over' : ''}`}>{short(totals.fc)}</b></span>
            </div>
            {projects.length === 0 ? <Empty title="Объектов пока нет" hint="Создайте первый объект, чтобы вести бюджет и сроки." action={acts.canWrite ? 'Создать объект' : undefined} onAction={() => create('project')} /> : mode === 'ribbons' ? (
              <>
                <ScaleLegend />
                <div className="ribbons">
                  {projects.map(p => {
                    const dev = deviations(data, p, today);
                    return (
                      <article className="ribbon" key={p.id}>
                        <div className="ribbon-id">
                          <span className="disp ribbon-code">{p.code}</span>
                          <button className="ribbon-name" onClick={() => openProject(p.id)}>{p.name}</button>
                          <span className="muted small">{p.address || 'Адрес не указан'} · РП {p.manager}</span>
                        </div>
                        <div className="ribbon-status">
                          <Status status={p.status} />
                          <ul className="dev-inline">{[['срок', dev.schedule], ['бюджет', dev.budget], ['снабжение', dev.supply]].map(([k, d]) => { const x = d as typeof dev.schedule; return <li key={k as string} data-tone={x.tone}><Mark kind={x.mark} size={12} /><span><em>{k as string}</em> {x.text}</span></li>; })}</ul>
                        </div>
                        <div className="ribbon-scales">
                          <div><small>Бюджет</small><TripleScale plan={p.budget} fact={p.actual} forecast={p.forecast} limit={Number(p.contractValue)} limitLabel="договор" max={max} label={`Бюджет ${p.name}`} size="sm" /></div>
                          <div><small>Готовность к сроку</small><TripleScale plan={elapsedShare(p.startDate, p.endDate, today)} fact={p.progress} max={100} format={n => `${Math.round(n)}%`} label={`Готовность ${p.name}`} size="sm" /></div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали">
                  <table className="tbl">
                    <thead><tr><th>Шифр</th><th>Объект</th><th>Стадия</th><th className="r">Готовность</th><th className="r">План</th><th className="r">Факт</th><th className="r">Прогноз</th><th>Отклонения</th></tr></thead>
                    <tbody>
                      {projects.map(p => {
                        const dev = deviations(data, p, today);
                        return (
                          <tr key={p.id}>
                            <td className="num">{p.code}</td>
                            <td><button className="link strong" onClick={() => openProject(p.id)}>{p.name}</button></td>
                            <td><Status status={p.status} /></td>
                            <td className="r num">{p.progress}%</td>
                            <td className="r num">{short(p.budget)}</td>
                            <td className="r num">{short(p.actual)}</td>
                            <td className={`r num ${p.variance < 0 ? 'is-over' : ''}`}>{short(p.forecast)}</td>
                            <td><span className="dev-marks">{[dev.schedule, dev.budget, dev.supply].map((x, i) => <span key={i} data-tone={x.tone} title={x.text}><Mark kind={x.mark} size={13} /><span className="sr-only">{['Срок', 'Бюджет', 'Снабжение'][i]}: {x.text}</span></span>)}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="sheet-sub"><h3>Бюджет: план, факт, прогноз по объектам</h3><ScaleLegend /><div className="stack">{projects.map(p => <div key={p.id} className="stack-row"><span className="stack-label">{p.code}</span><TripleScale plan={p.budget} fact={p.actual} forecast={p.forecast} limit={Number(p.contractValue)} limitLabel="договор" max={max} label={p.name} size="sm" values={false} /></div>)}</div></div>
              </>
            )}
          </Sheet>
  );
}

export function ProjectsPage() {
  const { data, create } = useErp();
  const acts = useActions();
  return (
    <div className="page">
      <header className="page-head">
        <div><h1 className="disp">Объекты</h1><p className="muted">{data.projects.length} объектов · план, факт и прогноз на общей шкале</p></div>
        {acts.canWrite && <button className="btn btn-mark" onClick={() => create('project')}>Создать объект</button>}
      </header>
      <Registry projects={data.projects} />
    </div>
  );
}
