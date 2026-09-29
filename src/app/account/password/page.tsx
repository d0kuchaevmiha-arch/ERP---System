'use client';
import { useState } from 'react';
import { BRAND } from '@/lib/brand';

// Смена пароля: обязательна после выдачи временного пароля, доступна и по кнопке в шапке.
export default function ChangePasswordPage() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.repeat) { setError('Новый пароль и повтор не совпадают'); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { window.location.assign('/login'); return; }
      if (!r.ok) throw new Error(j.error?.message || 'Не удалось сменить пароль');
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сменить пароль. Повторите попытку.');
    } finally { setLoading(false); }
  }

  return (
    <main className="sys">
      <form className="sheet login" onSubmit={submit} aria-labelledby="pwd-title">
        <div className="stamp sys-stamp">
          <div className="stamp-cell stamp-code"><small>Система</small><b className="disp">{BRAND.name}</b></div>
          <div className="stamp-cell stamp-name"><small>Учётная запись</small><h1 id="pwd-title" className="disp">Смена пароля</h1></div>
        </div>
        <div className="login-body">
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="field"><label htmlFor="cur">Текущий (или временный) пароль</label><input id="cur" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={e => setForm({ ...form, currentPassword: e.target.value })} /></div>
          <div className="field"><label htmlFor="new">Новый пароль — не короче 10 символов</label><input id="new" type="password" autoComplete="new-password" required minLength={10} value={form.newPassword} onChange={e => setForm({ ...form, newPassword: e.target.value })} /></div>
          <div className="field"><label htmlFor="rep">Повторите новый пароль</label><input id="rep" type="password" autoComplete="new-password" required minLength={10} value={form.repeat} onChange={e => setForm({ ...form, repeat: e.target.value })} /></div>
          <button className="btn btn-mark btn-xl" disabled={loading}>{loading ? 'Сохраняем…' : 'Сменить пароль'}</button>
          <a className="link" href="/">Отмена</a>
        </div>
      </form>
    </main>
  );
}
