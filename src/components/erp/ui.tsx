'use client';
import { useEffect, useRef, useState } from 'react';
import { metaOf } from './format';
import { usePref, useHydrated } from './prefs';
import { Tag } from './marks';

export function Status({ status, label }: { status: string; label?: string }) {
  const m = metaOf(status);
  return <Tag mark={m.mark} tone={m.tone}>{label || m.label}</Tag>;
}

// Время из БД показываем в часовом поясе пользователя — только после монтирования, чтобы не ловить расхождение SSR/клиент.
export function ClientTime({ value, mode = 'datetime' }: { value: string | Date; mode?: 'datetime' | 'date' }) {
  const hydrated = useHydrated();
  const d = new Date(value);
  const text = !hydrated ? '' : mode === 'date' ? d.toLocaleDateString('ru-RU') : d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return <time dateTime={d.toISOString()}>{text || '\u00a0'}</time>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: React.KeyboardEvent, i: number) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % options.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + options.length) % options.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = options.length - 1;
    if (next >= 0) { e.preventDefault(); onChange(options[next].value); refs.current[next]?.focus(); }
  }
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o, i) => (
        <button key={o.value} ref={el => { refs.current[i] = el; }} role="tab" type="button" aria-selected={value === o.value} tabIndex={value === o.value ? 0 : -1} onClick={() => onChange(o.value)} onKeyDown={e => onKey(e, i)}>
          {o.label}{o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, hint, action, onAction }: { title: string; hint?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {hint && <span>{hint}</span>}
      {action && onAction && <button type="button" className="btn" onClick={onAction}>{action}</button>}
    </div>
  );
}

export function Sheet({ title, aside, actions, children, className = '' }: { title?: React.ReactNode; aside?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`sheet ${className}`}>
      {(title || actions) && (
        <header className="sheet-head">
          <h2>{title}{aside !== undefined && <span className="sheet-count">{aside}</span>}</h2>
          {actions && <div className="sheet-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// Действие с подтверждением прямо в строке: без window.confirm и без модалки.
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, tone = 'primary' }: { label: string; confirmLabel?: string; onConfirm: () => void | Promise<void>; disabled?: boolean; tone?: 'primary' | 'plain' }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed) return <button type="button" className={`btn ${tone === 'primary' ? 'btn-mark' : ''}`} disabled={disabled || busy} onClick={e => { e.stopPropagation(); setArmed(true); }}>{label}</button>;
  return (
    <span className="confirm" onClick={e => e.stopPropagation()}>
      <button type="button" className="btn btn-mark" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setArmed(false); } }}>{busy ? '…' : confirmLabel || 'Подтвердить'}</button>
      <button type="button" className="btn" onClick={() => setArmed(false)}>Отмена</button>
    </span>
  );
}

export function useMedia(query: string, initial = false) {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function useStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  return usePref<T>(key, allowed, () => fallback, fallback);
}

export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
