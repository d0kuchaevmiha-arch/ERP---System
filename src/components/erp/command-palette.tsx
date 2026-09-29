'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { useErp } from './context';
import type { ViewKey } from './types';

type Cmd = { id: string; group: string; label: string; hint?: string; run: () => void };

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const erp = useErp();
  const { data, go, openProject, openDrawer, create, can } = erp;
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const uid = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo<Cmd[]>(() => {
    const cmds: Cmd[] = [];
    if (can('write')) {
      cmds.push(
        { id: 'a-purchase', group: 'Действия', label: 'Создать заявку на материал', run: () => create('purchase') },
        { id: 'a-expense', group: 'Действия', label: 'Внести расход', run: () => create('expense') },
        { id: 'a-progress', group: 'Действия', label: 'Внести выполнение', run: () => create('progress') },
        { id: 'a-movement', group: 'Действия', label: 'Внести движение материала', run: () => create('movement') },
        { id: 'a-task', group: 'Действия', label: 'Создать работу', run: () => create('task') },
        { id: 'a-project', group: 'Действия', label: 'Создать объект', run: () => create('project') },
      );
    }
    if (can('decide')) cmds.push({ id: 'a-receive', group: 'Действия', label: 'Принять поставку', run: () => create('receive') });
    const sections: [string, ViewKey, string?][] = [['Сегодня', 'today'], ['Объекты', 'projects', 'registry'], ['График работ', 'projects', 'schedule'], ['Деньги: бюджет', 'money', 'plan'], ['Деньги: расходы', 'money', 'expenses'], ['Закупки', 'supply', 'purchases'], ['Склад', 'supply', 'warehouse'], ['Материалы', 'refs', 'materials'], ['Контрагенты', 'refs', 'counterparties'], ['Договоры', 'refs', 'contracts'], ['Отчёты', 'refs', 'reports']];
    for (const [label, view, sub] of sections) cmds.push({ id: 's-' + label, group: 'Разделы', label, run: () => go(view, sub) });
    for (const p of data.projects) cmds.push({ id: 'p-' + p.id, group: 'Объекты', label: p.name, hint: p.code, run: () => openProject(p.id) });
    for (const p of data.purchases) cmds.push({ id: 'z-' + p.id, group: 'Заявки', label: `${p.number} · ${p.material}`, hint: p.project, run: () => openDrawer({ kind: 'purchase', id: p.id }) });
    for (const t of data.tasks) cmds.push({ id: 't-' + t.id, group: 'Работы', label: t.name, hint: t.project, run: () => openDrawer({ kind: 'task', id: t.id }) });
    for (const m of data.materials) cmds.push({ id: 'm-' + m.id, group: 'Материалы', label: m.name, hint: m.sku, run: () => openDrawer({ kind: 'material', id: m.id }) });
    for (const c of data.counterparties) cmds.push({ id: 'c-' + c.id, group: 'Контрагенты', label: c.name, hint: c.inn || undefined, run: () => openDrawer({ kind: 'counterparty', id: c.id }) });
    return cmds;
  }, [data, can, create, go, openProject, openDrawer]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length ? all.filter(c => words.every(w => `${c.label} ${c.hint || ''} ${c.group}`.toLowerCase().includes(w))) : all.slice(0, 14);
    return list.slice(0, 30);
  }, [q, all]);

  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  function key(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = shown[active]; if (c) { onClose(); c.run(); } }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  let lastGroup = '';
  return (
    <div className="modal-scrim palette-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Командная палитра" onKeyDown={key}>
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input autoFocus role="combobox" aria-expanded="true" aria-controls={uid + 'l'} aria-activedescendant={shown[active] ? `${uid}-${shown[active].id}` : undefined} aria-autocomplete="list" value={q} onChange={e => { setQ(e.target.value); setActive(0); }} placeholder="Объект, заявка, работа или действие…" aria-label="Найти или выполнить действие" />
          <kbd>Esc</kbd>
        </div>
        <ul id={uid + 'l'} ref={listRef} role="listbox" className="palette-list" aria-label="Результаты">
          {shown.length === 0 && <li className="palette-empty" role="presentation">Ничего не найдено. Попробуйте название объекта или номер заявки.</li>}
          {shown.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : '';
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {head && <div className="palette-group" role="presentation">{head}</div>}
                <div id={`${uid}-${c.id}`} role="option" aria-selected={i === active} className="palette-item" onMouseMove={() => setActive(i)} onClick={() => { onClose(); c.run(); }}>
                  <span>{c.label}</span>{c.hint && <small>{c.hint}</small>}{i === active && <CornerDownLeft size={14} aria-hidden="true" />}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
