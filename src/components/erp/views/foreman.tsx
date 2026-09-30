'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus, X } from 'lucide-react';
import { useErp } from '../context';
import { SyncMark } from '../desktop-sync';
import { useActions } from '../actions';
import { TripleScale } from '../triple-scale';
import { Status } from '../ui';
import { elapsedShare, lateDays } from '../derive';
import { dateShort, days } from '../format';
import type { Task } from '../types';

// Режим прораба: одна колонка, крупные цели касания, без таблиц.
export function ForemanView() {
  const { data, today, scopeId, create, go, user } = useErp();
  const acts = useActions();
  const [wizard, setWizard] = useState<string | null>(null);
  const project = data.projects.find(p => p.id === scopeId);
  const todays = data.tasks
    .filter(t => (!scopeId || t.projectId === scopeId) && ['work', 'subtask'].includes(t.kind) && t.progress < 100 && t.startDate && t.startDate <= today)
    .sort((a, b) => Number(b.delayed) - Number(a.delayed) || (a.endDate || '').localeCompare(b.endDate || ''));

  return (
    <div className="foreman">
      <header className="foreman-head">
        <h1 className="disp">Работы на сегодня</h1>
        <p className="muted">{project ? project.name : 'Все объекты'} · {new Date(today + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>
      </header>
      <div className="foreman-actions">
        <button className="btn btn-mark btn-xl" disabled={!acts.canWrite || todays.length === 0} onClick={() => setWizard('')}>Внести выполнение</button>
        <button className="btn btn-xl" disabled={!acts.canWrite} onClick={() => create('purchase', scopeId ? { projectId: scopeId } : {})}>Заявка на материал</button>
        {!acts.canWrite && <p className="muted small">{user ? 'Ваша роль не позволяет вносить данные.' : 'Войдите, чтобы вносить выполнение и заявки.'}</p>}
      </div>
      {todays.length === 0 ? (
        <div className="empty"><b>На сегодня работ нет</b><span>Все начатые работы выполнены. Если нужна новая работа, попросите руководителя проекта её создать.</span></div>
      ) : (
        <ul className="foreman-list">
          {todays.map(t => (
            <li key={t.id}>
              <button type="button" className="work-card" disabled={!acts.canWrite} onClick={() => setWizard(t.id)}>
                <span className="work-title"><b>{t.name}</b><Status status={t.delayed ? 'delayed' : t.status} /></span>
                <span className="muted small">{t.project} · до {dateShort(t.endDate)}{t.delayed ? ` · позже срока на ${days(lateDays(t, today))}` : ''}</span>
                <TripleScale plan={elapsedShare(t.startDate, t.endDate, today)} fact={t.progress} max={100} format={n => `${Math.round(n)}%`} label={`Готовность: ${t.name}`} values={false} />
                <span className="num work-pct">{t.progress}%<SyncMark id={t.id} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="link foreman-full" onClick={() => go('projects', 'registry')}><ArrowLeft size={15} aria-hidden="true" /> Полная версия</button>
      {wizard !== null && <ProgressWizard tasks={todays} initial={wizard} onClose={() => setWizard(null)} />}
    </div>
  );
}

// Шаги: работа → готовность и объём → проверка и отправка.
function ProgressWizard({ tasks, initial, onClose }: { tasks: Task[]; initial: string; onClose: () => void }) {
  const acts = useActions();
  const [step, setStep] = useState(initial ? 2 : 1);
  const [taskId, setTaskId] = useState(initial);
  const [pct, setPct] = useState(() => tasks.find(t => t.id === initial)?.progress ?? 0);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const task = tasks.find(t => t.id === taskId);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button,input')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);

  async function send() {
    if (!task) return;
    setBusy(true); setError('');
    const ok = await acts.setProgress(task, pct, qty ? Number(qty) : undefined);
    setBusy(false);
    if (ok) onClose(); else setError('Не удалось внести выполнение. Проверьте связь и повторите.');
  }
  const clamp = (n: number) => Math.min(100, Math.max(0, n));

  return (
    <div className="modal-scrim sheet-scrim">
      <div className="modal modal-full" role="dialog" aria-modal="true" aria-labelledby={uid} ref={ref}>
        <div className="modal-head">
          <div><small>Шаг {step} из 3</small><h2 id={uid} className="disp">{step === 1 ? 'Выберите работу' : step === 2 ? 'Сколько выполнено' : 'Проверьте и отправьте'}</h2></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error" role="alert">{error}</div>}
          {step === 1 && (
            <ul className="foreman-list">{tasks.map(t => <li key={t.id}><button type="button" className="work-card" aria-pressed={taskId === t.id} onClick={() => { setTaskId(t.id); setPct(t.progress); setStep(2); }}><span className="work-title"><b>{t.name}</b></span><span className="muted small">{t.project} · сейчас {t.progress}%</span></button></li>)}</ul>
          )}
          {step === 2 && task && (
            <div className="wiz-pct">
              <p className="muted">{task.name}</p>
              <div className="pct-big num" aria-live="polite">{pct}%</div>
              <div className="pct-controls">
                <button type="button" className="btn btn-xl" aria-label="Уменьшить на 5 процентов" onClick={() => setPct(clamp(pct - 5))}><Minus size={20} /></button>
                <input type="range" min={0} max={100} step={1} value={pct} onChange={e => setPct(Number(e.target.value))} aria-label="Готовность, %" />
                <button type="button" className="btn btn-xl" aria-label="Увеличить на 5 процентов" onClick={() => setPct(clamp(pct + 5))}><Plus size={20} /></button>
              </div>
              <div className="chips" role="group" aria-label="Быстрый выбор">{[25, 50, 75, 100].map(n => <button type="button" key={n} className="chip chip-xl" aria-pressed={pct === n} onClick={() => setPct(n)}>{n}%</button>)}</div>
              <div className="field"><label htmlFor={uid + 'q'}>Выполненный объём, {task.unit}</label><input id={uid + 'q'} type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder={String(Number(task.actualQuantity))} /></div>
            </div>
          )}
          {step === 3 && task && (
            <dl className="kv"><div><dt>Работа</dt><dd>{task.name}</dd></div><div><dt>Объект</dt><dd>{task.project}</dd></div><div><dt>Готовность</dt><dd className="num">{task.progress}% → {pct}%</dd></div><div><dt>Объём</dt><dd className="num">{qty ? `${qty} ${task.unit}` : 'не менялся'}</dd></div></dl>
          )}
        </div>
        <div className="modal-foot">
          {step > 1 ? <button type="button" className="btn btn-xl" onClick={() => setStep(step - 1)}>Назад</button> : <button type="button" className="btn btn-xl" onClick={onClose}>Отмена</button>}
          {step === 2 && <button type="button" className="btn btn-mark btn-xl" onClick={() => setStep(3)}>Далее</button>}
          {step === 3 && <button type="button" className="btn btn-mark btn-xl" disabled={busy} onClick={send}>{busy ? 'Отправляем…' : 'Отправить'}</button>}
        </div>
      </div>
    </div>
  );
}
