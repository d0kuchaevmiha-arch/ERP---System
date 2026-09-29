'use client';
import { useCallback, useEffect, useState } from 'react';
import { useErp } from '../context';
import { ConfirmButton, Empty, Sheet } from '../ui';
import { roleLabel } from '@/lib/permissions';

type Access = { projectId: string; permission: 'view' | 'edit' };
type UserRow = { id: string; name: string; email: string; role: string; isActive: boolean; mustChangePassword: boolean; access: Access[] };
type Secret = { email: string; password: string } | null;

const assignable = Object.keys(roleLabel);

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || 'Операция не выполнена');
  return j.data;
}

// Управление пользователями организации: создание, роль, блокировка, сброс пароля, доступ к объектам.
// Все проверки прав — на сервере (команды users.* и access.*); экран лишь не показывает недоступное.
export function UsersView() {
  const { data, user, notify } = useErp();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState<Secret>(null);
  const [open, setOpen] = useState<string>('');
  const [form, setForm] = useState({ name: '', email: '', role: 'foreman' });
  const [busy, setBusy] = useState(false);

  // Список перечитывается при каждом изменении version; состояние меняется только в ответе сервера.
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => setVersion(v => v + 1), []);
  useEffect(() => {
    let alive = true;
    call('/api/admin/users', 'GET')
      .then(list => { if (alive) { setRows(list); setError(''); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Не удалось загрузить пользователей'); });
    return () => { alive = false; };
  }, [version]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); notify(ok); await load(); return true; }
    catch (e) { notify(e instanceof Error ? e.message : 'Операция не выполнена', 'err'); return false; }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await call('/api/admin/users', 'POST', form);
      setSecret({ email: r.user.email, password: r.temporaryPassword });
      setForm({ name: '', email: '', role: 'foreman' });
      notify('Пользователь создан'); await load();
    } catch (err) { notify(err instanceof Error ? err.message : 'Не удалось создать пользователя', 'err'); }
    finally { setBusy(false); }
  }

  async function resetPassword(u: UserRow) {
    try { const r = await call(`/api/admin/users/${u.id}/reset-password`, 'POST'); setSecret({ email: u.email, password: r.temporaryPassword }); notify('Пароль сброшен'); await load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Не удалось сбросить пароль', 'err'); }
  }

  const setAccess = (u: UserRow, projectId: string, permission: string) => act(
    () => permission ? call(`/api/admin/users/${u.id}/access/${projectId}`, 'PUT', { permission }) : call(`/api/admin/users/${u.id}/access/${projectId}`, 'DELETE'),
    permission ? 'Доступ сохранён' : 'Доступ отозван',
  );

  return (
    <div className="page">
      <header className="page-head"><div><h1 className="disp">Пользователи</h1><p className="muted">Роли, доступ к объектам, блокировка и сброс пароля</p></div></header>

      {secret && (
        <div className="form-error" role="status" data-tone="ok">
          Временный пароль для <b>{secret.email}</b>: <code className="num">{secret.password}</code>. Передайте его пользователю — больше он показан не будет; при входе потребуется сменить пароль.
          {' '}<button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(secret.password); notify('Скопировано'); }}>Копировать</button>
          {' '}<button type="button" className="btn" onClick={() => setSecret(null)}>Скрыть</button>
        </div>
      )}

      <Sheet title="Новый пользователь">
        <form className="login-body" onSubmit={createUser}>
          <div className="field"><label htmlFor="u-name">ФИО</label><input id="u-name" required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-email">Электронная почта</label><input id="u-email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-role">Роль</label>
            <select id="u-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              {assignable.filter(r => r !== 'super_admin' || user?.role === 'super_admin').map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
            </select>
          </div>
          <button className="btn btn-mark" disabled={busy}>{busy ? 'Создаём…' : 'Создать'}</button>
        </form>
      </Sheet>

      <Sheet title="Пользователи организации" aside={rows?.length}>
        {error ? <Empty title="Список недоступен" hint={error} /> : !rows ? <Empty title="Загрузка…" /> : rows.length === 0 ? <Empty title="Пользователей нет" /> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица пользователей, прокручивается по горизонтали">
            <table className="tbl">
              <thead><tr><th>Пользователь</th><th>Роль</th><th>Состояние</th><th>Объекты</th><th className="r">Действия</th></tr></thead>
              <tbody>{rows.map(u => {
                const self = u.email === user?.email;
                const protectedAdmin = u.role === 'super_admin' && user?.role !== 'super_admin';
                const locked = self || protectedAdmin;
                return [
                  <tr key={u.id}>
                    <td><b>{u.name}</b><br /><small className="muted">{u.email}</small></td>
                    <td>
                      <select aria-label={`Роль: ${u.name}`} value={u.role} disabled={locked} onChange={e => act(() => call(`/api/admin/users/${u.id}`, 'PATCH', { role: e.target.value }), 'Роль изменена')}>
                        {assignable.filter(r => r !== 'super_admin' || user?.role === 'super_admin' || u.role === 'super_admin').map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                      </select>
                    </td>
                    <td>{!u.isActive ? <span className="tag" data-tone="err">Заблокирован</span> : u.mustChangePassword ? <span className="tag" data-tone="warn">Ждёт смены пароля</span> : <span className="tag" data-tone="ok">Активен</span>}</td>
                    <td>{['director', 'super_admin'].includes(u.role) ? <span className="muted">Все объекты</span> : <button type="button" className="link" onClick={() => setOpen(open === u.id ? '' : u.id)} aria-expanded={open === u.id}>{u.access.length} из {data.projects.length}</button>}</td>
                    <td className="r">
                      {!locked && (u.isActive
                        ? <ConfirmButton tone="plain" label="Заблокировать" confirmLabel="Заблокировать" onConfirm={() => act(() => call(`/api/admin/users/${u.id}`, 'PATCH', { isActive: false }), 'Пользователь заблокирован, сессии завершены').then(() => undefined)} />
                        : <button type="button" className="btn" onClick={() => act(() => call(`/api/admin/users/${u.id}`, 'PATCH', { isActive: true }), 'Пользователь разблокирован')}>Разблокировать</button>)}
                      {' '}{!locked && <ConfirmButton tone="plain" label="Сбросить пароль" confirmLabel="Сбросить" onConfirm={() => resetPassword(u)} />}
                    </td>
                  </tr>,
                  open === u.id && (
                    <tr key={`${u.id}-access`}><td colSpan={5}>
                      <ul className="report-list">{data.projects.map(p => {
                        const current = u.access.find(a => a.projectId === p.id)?.permission || '';
                        return (
                          <li key={p.id}><span><b>{p.code}</b> · {p.name}</span>
                            <select aria-label={`Доступ к ${p.name}`} value={current} onChange={e => setAccess(u, p.id, e.target.value)}>
                              <option value="">Нет доступа</option><option value="view">Просмотр</option><option value="edit">Ввод данных</option>
                            </select>
                          </li>
                        );
                      })}</ul>
                    </td></tr>
                  ),
                ];
              })}</tbody>
            </table>
          </div>
        )}
      </Sheet>
    </div>
  );
}
