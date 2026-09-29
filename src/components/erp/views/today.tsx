'use client';
import { useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { useErp } from '../context';
import { useActions } from '../actions';
import { buildQueue, type QueueItem } from '../derive';
import { Registry } from './registry';
import { Mark } from '../marks';
import { ConfirmButton, Empty, Sheet } from '../ui';
import { Marginalia } from '../marginalia';
import { plural } from '../format';

export function TodayView() {
  const erp = useErp();
  const { data, today, scopeId, openDrawer, create } = erp;
  const acts = useActions();
  const [all, setAll] = useState(false);
  const queue = buildQueue(data, today, acts.canDecide, scopeId);
  const shown = all ? queue : queue.slice(0, 8);
  const projects = data.projects.filter(p => !scopeId || p.id === scopeId);
  const dateLong = new Date(today + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  // Единственная красная кнопка очереди — у самой срочной строки; остальные действия обычные.
  function run(item: QueueItem, primary: boolean): React.ReactNode {
    const a = item.action;
    if (a.type === 'approve') return <ConfirmButton tone={primary ? 'primary' : 'plain'} label={item.actionLabel} confirmLabel="Да, согласовать" onConfirm={() => acts.approve(a.id).then(() => undefined)} />;
    if (a.type === 'receive') {
      const p = data.purchases.find(x => x.id === a.id);
      return <ConfirmButton tone={primary ? 'primary' : 'plain'} label={item.actionLabel} confirmLabel="Да, принять остаток" onConfirm={() => (p ? acts.receiveRest(p).then(() => undefined) : undefined)} />;
    }
    if (a.type === 'drawer') return <button className="btn" onClick={() => openDrawer(a.ref)}>{item.actionLabel}</button>;
    if (a.type === 'progress') return <button className={`btn ${primary ? 'btn-mark' : ''}`} onClick={() => openDrawer({ kind: 'task', id: a.id })}>{item.actionLabel}</button>;
    return acts.canWrite ? <button className="btn" onClick={() => create('purchase', { materialId: a.materialId, ...(a.projectId ? { projectId: a.projectId } : {}) })}>{item.actionLabel}</button> : null;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="disp">Сегодня</h1>
          <p className="muted">{dateLong} · {queue.length ? `${queue.length} ${plural(queue.length, 'вопрос ждёт', 'вопроса ждут', 'вопросов ждут')} решения` : 'срочных вопросов нет'}</p>
        </div>
        <button className="btn margin-toggle" onClick={() => openDrawer({ kind: 'notes', id: scopeId })}><MessageSquareText size={16} aria-hidden="true" />Замечания и изменения</button>
      </header>
      <div className="page-grid">
        <div className="page-main">
          <Sheet title="Очередь решений" aside={queue.length}>
            {queue.length === 0 ? (
              <Empty title="Очередь пуста" hint="Все заявки согласованы, поставки идут в срок, отставаний нет." action={acts.canWrite ? 'Создать заявку' : undefined} onAction={() => create('purchase')} />
            ) : (
              <>
                <ol className="queue">
                  {shown.map((item, idx) => (
                    <li key={item.id} className="queue-row" data-tone={item.tone}>
                      <span className="queue-mark" data-tone={item.tone}><Mark kind={item.mark} size={16} /></span>
                      <div className="queue-text">
                        <b>{item.title}</b>
                        <span className="muted">{item.where}</span>
                        <span className="queue-why">{item.why}</span>
                      </div>
                      <div className="queue-action">{run(item, idx === 0)}</div>
                    </li>
                  ))}
                </ol>
                {queue.length > 8 && <button className="link-more" onClick={() => setAll(!all)}>{all ? 'Показать только срочные' : `Показать все (${queue.length})`}</button>}
              </>
            )}
          </Sheet>

          <Registry projects={projects} />
        </div>
        <div className="page-margin"><Marginalia projectId={scopeId || undefined} /></div>
      </div>
    </div>
  );
}
