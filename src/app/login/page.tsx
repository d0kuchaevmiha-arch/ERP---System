'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || 'Не удалось войти. Проверьте почту и пароль.');
      router.push('/'); router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти. Повторите попытку.');
    } finally { setLoading(false); }
  }

  return (
    <main className="sys">
      <form className="sheet login" onSubmit={submit} aria-labelledby="login-title">
        <div className="stamp sys-stamp">
          <div className="stamp-cell stamp-code"><small>Система</small><b className="disp">{BRAND.name}</b></div>
          <div className="stamp-cell stamp-name"><small>{BRAND.product}</small><h1 id="login-title" className="disp">Вход в систему</h1></div>
        </div>
        <div className="login-body">
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="field"><label htmlFor="email">Электронная почта</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.ru" /></div>
          <div className="field"><label htmlFor="password">Пароль</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
          <button className="btn btn-mark btn-xl" disabled={loading}>{loading ? 'Входим…' : 'Войти'}</button>
        </div>
      </form>
    </main>
  );
}
