'use client';
import { useState } from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { scopeToSave } from '@/lib/offline-scope';

type Project = { id: string; code: string; name: string };

export function OfflineScopeForm({ available, selected, defaultScope, orgWide }: { available: Project[]; selected: string[] | null; defaultScope: string[]; orgWide: boolean }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(selected ?? defaultScope));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (id: string) => setChosen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save(projects: string[] | null) {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/client/scope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || 'Не удалось сохранить');
      window.location.assign('/');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить'); setBusy(false); }
  }

  return (
    <main className="sys">
      <section className="sheet login" aria-labelledby="offline-title">
        <div className="stamp sys-stamp">
          <div className="stamp-cell stamp-code"><small>Система</small><b className="disp">{BRAND.name}</b></div>
          <div className="stamp-cell stamp-name"><small>Этот компьютер</small><h1 id="offline-title" className="disp">Доступно офлайн</h1></div>
        </div>
        <div className="login-body">
          <p className="muted">Данные отмеченных объектов хранятся на этом компьютере и доступны без связи. {orgWide ? 'Вам доступны все объекты организации — отметьте нужные.' : 'По умолчанию — все объекты, к которым у вас есть доступ, включая новые. Если снять отметку с какого-то объекта, новые объекты будут добавляться только те, что вы создаёте сами.'} После сохранения данные загрузятся заново.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          {available.length === 0 ? <p>Нет доступных объектов.</p> : (
            <ul className="report-list">{available.map(p => (
              <li key={p.id}><label><input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} /> <b>{p.code}</b> · {p.name}</label></li>
            ))}</ul>
          )}
          <button type="button" className="btn btn-mark btn-xl" disabled={busy} onClick={() => save(scopeToSave(chosen, available, orgWide))}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
          {!orgWide && <button type="button" className="btn" disabled={busy} onClick={() => save(null)}>По умолчанию (все доступные)</button>}
          <Link className="link" href="/">Отмена</Link>
        </div>
      </section>
    </main>
  );
}
