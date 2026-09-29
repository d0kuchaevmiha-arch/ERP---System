'use client';
import { useMemo } from 'react';
import { useElementWidth } from '../ui';
import { useErp } from '../context';
import { useActions } from '../actions';
import { Empty, Sheet } from '../ui';
import { Mark } from '../marks';
import { daysBetween, days, toDay, taskKindLabel, plural } from '../format';
import { lateDays } from '../derive';
import type { Task } from '../types';

const LABEL_W = 280; // ширина колонки с названиями работ, px

// График работ на осях: горизонталь — время, вертикаль — уровни WBS (код работы).
export function PlanView() {
  const { data, today, scopeId, openDrawer, create } = useErp();
  const acts = useActions();
  const tasks = data.tasks.filter(t => !scopeId || t.projectId === scopeId);
  const dated = tasks.filter(t => t.startDate && t.endDate);
  const undated = tasks.length - dated.length;

  const [boxRef, boxWidth] = useElementWidth<HTMLDivElement>();
  const span = useMemo(() => {
    if (!dated.length) return null;
    const start = Math.min(...dated.map(t => toDay(t.startDate as string)), toDay(today));
    const end = Math.max(...dated.map(t => toDay(t.endDate as string)), toDay(today));
    const first = new Date((start - 5) * 86_400_000);
    first.setUTCDate(1);
    return { from: Math.floor(first.getTime() / 86_400_000), to: end + 14 };
  }, [dated, today]);
  // Масштаб подбирается так, чтобы весь план помещался в ширину листа; на узких экранах включается прокрутка.
  const labelW = boxWidth && boxWidth < 700 ? 180 : LABEL_W;
  const px = span ? Math.min(10, Math.max(3, Math.floor(((boxWidth || 1000) - labelW - 6) / (span.to - span.from)))) : 5;

  const model = useMemo(() => {
    if (!span) return null;
    const { from, to } = span;
    const months: { left: number; label: string }[] = [];
    const cursor = new Date(from * 86_400_000);
    while (Math.floor(cursor.getTime() / 86_400_000) <= to) {
      const d = Math.floor(cursor.getTime() / 86_400_000);
      months.push({ left: (d - from) * px, label: cursor.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const groups = data.projects.filter(p => !scopeId || p.id === scopeId).map(p => {
      const own = dated.filter(t => t.projectId === p.id);
      const depth = (t: Task): number => { let d = 0; let cur: Task | undefined = t; const seen = new Set<string>(); while (cur?.parentId && !seen.has(cur.id)) { seen.add(cur.id); cur = own.find(x => x.id === cur!.parentId); if (cur) d++; } return d; };
      const sorted = [...own].sort((a, b) => (a.code || '').localeCompare(b.code || '', 'ru', { numeric: true }) || (a.startDate as string).localeCompare(b.startDate as string));
      return { p, rows: sorted.map(t => ({ t, depth: depth(t) })) };
    }).filter(g => g.rows.length);
    return { from, width: (to - from) * px, months, todayX: (toDay(today) - from) * px, groups };
  }, [span, px, dated, today, data.projects, scopeId]);

  if (!model) return <div className="page"><header className="page-head"><h1 className="disp">График работ</h1></header><Sheet><Empty title="Работ с датами нет" hint="Добавьте работу с датой начала и окончания, чтобы увидеть её на графике." action={acts.canWrite ? 'Создать работу' : undefined} onAction={() => create('task', scopeId ? { projectId: scopeId } : {})} /></Sheet></div>;
  const lateCount = dated.filter(t => t.delayed).length;

  return (
    <div className="page">
      <header className="page-head">
        <div><h1 className="disp">График работ</h1><p className="muted">{dated.length} {plural(dated.length, 'работа', 'работы', 'работ')} · {lateCount ? `${lateCount} с отставанием` : 'отставаний нет'}{undated ? ` · ${undated} без дат не показаны` : ''}</p></div>
        {acts.canWrite && <button className="btn" onClick={() => create('task', scopeId ? { projectId: scopeId } : {})}>Создать работу</button>}
      </header>
      <Sheet>
        <div className="ts-legend" aria-label="Обозначения графика">
          <span><i className="k-plan" />плановый срок</span><span><i className="k-fact" />выполнено</span><span className="lg-behind"><Mark kind="behind" size={12} />отставание, дней</span><span><i className="k-today" />сегодня</span>
        </div>
        <div className="gantt" ref={boxRef} tabIndex={0} role="region" aria-label="График работ, прокручивается по горизонтали">
          <div className="gantt-inner" style={{ width: labelW + model.width, ['--label-w' as string]: `${labelW}px` }}>
            <div className="gantt-head">
              <div className="gantt-label gantt-corner">Работа</div>
              <div className="gantt-axis" style={{ width: model.width }}>
                {model.months.map((m, i) => <span key={i} className="gantt-tick" style={{ left: m.left }}>{m.label}</span>)}
                <span className="gantt-today-flag" style={{ left: model.todayX }}>сегодня</span>
              </div>
            </div>
            <div className="gantt-grid" aria-hidden="true" style={{ width: model.width }}>
              {model.months.map((m, i) => <i key={i} style={{ left: m.left }} />)}
              <i className="today" style={{ left: model.todayX }} />
            </div>
            {model.groups.map(g => (
              <div key={g.p.id} className="gantt-group">
                <div className="gantt-group-head"><span className="disp">{g.p.code}</span> {g.p.name}</div>
                {g.rows.map(({ t, depth }) => {
                  const left = (toDay(t.startDate as string) - model.from) * px;
                  const w = Math.max(px * 2, (daysBetween(t.startDate as string, t.endDate as string) + 1) * px);
                  const late = t.delayed ? lateDays(t, today) : 0;
                  return (
                    <div className="gantt-row" key={t.id}>
                      <div className="gantt-label" style={{ paddingLeft: 12 + depth * 14 }}>
                        <button type="button" className="link strong" onClick={() => openDrawer({ kind: 'task', id: t.id })}>{t.name}</button>
                        <small><span className="num">{t.code || '·'}</span> · {taskKindLabel[t.kind] || t.kind} · {t.progress}%</small>
                      </div>
                      <div className="gantt-lane" style={{ width: model.width }}>
                        <button type="button" className="gantt-bar" data-late={late > 0 || undefined} style={{ left, width: w }} onClick={() => openDrawer({ kind: 'task', id: t.id })} aria-label={`${t.name}: готовность ${t.progress}%${late ? `, отставание ${days(late)}` : ''}`}>
                          <span className="gantt-fill" style={{ width: `${t.progress}%` }} />
                        </button>
                        {late > 0 && <span className="gantt-late" style={left + w + 80 > model.width ? { left: left - 6, transform: 'translateX(-100%)' } : { left: left + w + 6 }}><Mark kind="behind" size={12} />−{days(late)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Sheet>
      <p className="muted small">Отставание считается по плановой дате окончания и готовности. Зависимости между работами и критический путь пока не рассчитываются.</p>
    </div>
  );
}
