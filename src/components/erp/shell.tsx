'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Building2, KeyRound, ListChecks, Moon, PanelLeftClose, PanelLeftOpen, Rows3, Rows4, Search, ShieldAlert, Sun, Truck, Wallet, LogOut, LogIn } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Overview } from '@/lib/overview';
import { BRAND } from '@/lib/brand';
import { can as canDo, roleLabel, type Ability } from '@/lib/permissions';
import { ErpContext, type Density, type Erp, type PostResult, type Theme } from './context';
import type { CreateKind, CreateState, DrawerRef, Nav, User, ViewKey } from './types';
import { Segmented, useMedia } from './ui';
import { usePref } from './prefs';
import { Drawer } from './drawer';
import { CreateDialog } from './create-dialog';
import { CommandPalette } from './command-palette';
import { TodayView } from './views/today';
import { ProjectsPage } from './views/registry';
import { ProjectView } from './views/project';
import { PlanView } from './views/plan';
import { ProcurementView } from './views/procurement';
import { WarehouseView } from './views/warehouse';
import { MoneyView } from './views/money';
import { RefsView } from './views/refs';
import { ForemanView } from './views/foreman';
import { UsersView } from './views/users';
import { newOpKey } from './op-key';
import { DesktopSync } from './desktop-sync';
import { SyncView } from './views/sync';

type Toast = { id: number; text: string; tone: 'ok' | 'err' };

const railItems: { view: ViewKey; label: string; icon: LucideIcon; sub?: string }[] = [
  { view: 'today', label: 'Сегодня', icon: ListChecks },
  { view: 'projects', label: 'Объекты', icon: Building2, sub: 'registry' },
  { view: 'money', label: 'Деньги', icon: Wallet, sub: 'plan' },
  { view: 'supply', label: 'Снабжение', icon: Truck, sub: 'purchases' },
  { view: 'refs', label: 'Справочники', icon: BookOpen, sub: 'materials' },
  { view: 'sync', label: 'Требует решения', icon: ShieldAlert, sub: 'conflicts' },
];
const subs: Partial<Record<ViewKey, { value: string; label: string }[]>> = {
  projects: [{ value: 'registry', label: 'Реестр' }, { value: 'schedule', label: 'График работ' }],
  money: [{ value: 'plan', label: 'Бюджет' }, { value: 'expenses', label: 'Расходы' }],
  supply: [{ value: 'purchases', label: 'Закупки' }, { value: 'warehouse', label: 'Склад' }],
  refs: [{ value: 'materials', label: 'Материалы' }, { value: 'counterparties', label: 'Контрагенты' }, { value: 'contracts', label: 'Договоры' }, { value: 'reports', label: 'Отчёты' }, { value: 'users', label: 'Пользователи' }],
  sync: [{ value: 'conflicts', label: 'Требует решения' }, { value: 'rejected', label: 'Не принято сервером' }, { value: 'queue', label: 'Очередь' }],
};
// Экраны очереди есть только в десктопе.
const DESKTOP_SUBS = ['rejected', 'queue'];
// Что можно вводить без связи (§5.1): ресурсы API и виды форм. Остальное в десктопе без связи — «нужна связь».
const OFFLINE_RESOURCES = ['progress', 'expenses', 'purchases', 'movements', 'receive'];
const OFFLINE_FORMS: CreateKind[] = ['expense', 'purchase', 'movement', 'receive', 'progress', 'login'];
const NEED_LINK = 'Нужна связь с сервером: это действие выполняется только онлайн';
// Экран «Пользователи» виден только тем, кому сервер разрешит управлять пользователями.
const USER_ADMINS = ['director', 'super_admin'];
// Ссылки старого интерфейса (?view=finance и т. п.) продолжают работать.
const legacy: Record<string, Nav> = {
  dashboard: { view: 'today', sub: '' }, projects: { view: 'projects', sub: 'registry' }, planning: { view: 'projects', sub: 'schedule' }, tasks: { view: 'projects', sub: 'schedule' },
  finance: { view: 'money', sub: 'plan' }, procurement: { view: 'supply', sub: 'purchases' }, warehouse: { view: 'supply', sub: 'warehouse' },
  materials: { view: 'refs', sub: 'materials' }, counterparties: { view: 'refs', sub: 'counterparties' }, contracts: { view: 'refs', sub: 'contracts' }, reports: { view: 'refs', sub: 'reports' },
};
const isView = (v: string): v is ViewKey => ['today', 'projects', 'money', 'supply', 'refs', 'sync'].includes(v);

function parseLocation(): { nav: Nav; scope: string } | null {
  const m = window.location.pathname.match(/^\/projects\/([^/]+)/);
  if (m) return { nav: { view: 'projects', sub: 'registry' }, scope: m[1] };
  const q = new URLSearchParams(window.location.search);
  const v = q.get('view'); const sub = q.get('sub') || '';
  if (!v) return { nav: { view: 'today', sub: '' }, scope: q.get('scope') || '' };
  if (legacy[v] && !q.get('sub')) return { nav: legacy[v], scope: q.get('scope') || '' };
  if (isView(v)) return { nav: { view: v, sub }, scope: q.get('scope') || '' };
  return null;
}

function urlFor(n: Nav, scope: string) {
  if (scope && n.view === 'projects' && n.sub !== 'schedule') return `/projects/${scope}`;
  const q = new URLSearchParams();
  if (n.view !== 'today' || n.sub) q.set('view', n.view);
  if (n.sub) q.set('sub', n.sub);
  if (scope) q.set('scope', scope);
  const s = q.toString();
  return s ? `/?${s}` : '/';
}
function push(n: Nav, scope: string) { try { window.history.pushState({}, '', urlFor(n, scope)); } catch { /* iframe и т. п. */ } }

export default function Workspace({ initial, currentUser, projectId, today: serverToday }: { initial: Overview; currentUser: User; projectId?: string; today?: string }) {
  const [data, setData] = useState(initial);
  const [user, setUser] = useState<User>(currentUser);
  const today = serverToday || new Date().toISOString().slice(0, 10);
  const [scopeId, setScopeId] = useState(projectId || '');
  const [nav, setNav] = useState<Nav>(projectId ? { view: 'projects', sub: 'registry' } : { view: 'today', sub: '' });
  const [drawer, setDrawer] = useState<DrawerRef>(null);
  const [creating, setCreating] = useState<CreateState>(null);
  const [palette, setPalette] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const isPhone = useMedia('(max-width: 480px)');
  const mainRef = useRef<HTMLElement>(null);
  const toastId = useRef(0);

  // Тема и плотность: до первой отрисовки их выставляет скрипт в <head>; здесь состояние читается из localStorage без эффектов.
  const [theme, setThemePref] = usePref<Theme>('erp.theme', ['light', 'dark'], () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), 'light');
  const [density, setDensityPref] = usePref<Density>('erp.density', ['compact', 'comfortable'], () => 'compact', 'compact');
  const [rail, setRail] = usePref<'narrow' | 'wide'>('erp.rail', ['narrow', 'wide'], () => 'narrow', 'narrow');
  const railWide = rail === 'wide';
  const setTheme = useCallback((t: Theme) => { document.documentElement.dataset.theme = t; setThemePref(t); }, [setThemePref]);
  const setDensity = useCallback((d: Density) => { document.documentElement.dataset.density = d; setDensityPref(d); }, [setDensityPref]);
  const toggleRail = () => setRail(railWide ? 'narrow' : 'wide');
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.density = density; }, [theme, density]);

  // Разбираем адрес при загрузке и при «назад/вперёд».
  useEffect(() => {
    // Адресная строка — внешняя система: один раз читаем её после монтирования (на сервере адрес с параметрами недоступен).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!projectId) { const p = parseLocation(); if (p) { setNav(p.nav); setScopeId(p.scope); } }
    const onPop = () => { const p = parseLocation(); if (p) { setNav(p.nav); setScopeId(p.scope); setDrawer(null); } };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const notify = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = ++toastId.current;
    setToasts(t => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'err' ? 8000 : 4500);
  }, []);

  const [live, setLive] = useState(false);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/overview', { cache: 'no-store' });
      // Сессию отозвали (блокировка, сброс пароля) — данные на экране не оставляем.
      if (r.status === 401) { window.location.assign('/login'); return; }
      if (r.ok) { setData(await r.json()); setSyncedAt(new Date()); }
    } catch { /* остаёмся на текущих данных */ }
  }, []);

  // Реальное время (§6.5): сигнал SSE «данные изменились» → через 1,5 с перечитываем сводку
  // (несколько изменений подряд — одно обновление). Без SSE — опрос раз в 30 с.
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 1500); };
    const es = new EventSource('/api/sync/events');
    // После (пере)подключения — одно перечитывание: изменения, случившиеся без подписки (загрузка страницы, обрыв), не теряются.
    es.addEventListener('ready', () => { setLive(true); later(); });
    es.addEventListener('changes', later);
    es.onerror = () => setLive(false);
    const poll = setInterval(() => { if (es.readyState !== EventSource.OPEN) void refresh(); }, 30_000);
    return () => { clearTimeout(timer); clearInterval(poll); es.close(); };
  }, [user, refresh]);

  const go = useCallback((view: ViewKey, sub?: string) => {
    const n = { view, sub: sub ?? railItems.find(r => r.view === view)?.sub ?? '' };
    setNav(n); setDrawer(null);
    push(n, scopeId);
    window.scrollTo({ top: 0 });
  }, [scopeId]);

  const setScope = useCallback((id: string) => {
    setScopeId(id);
    push(nav, id);
  }, [nav]);

  const openProject = useCallback((id: string) => {
    const n: Nav = { view: 'projects', sub: 'registry' };
    setScopeId(id); setNav(n); setDrawer(null); push(n, id);
    window.scrollTo({ top: 0 });
  }, []);

  const can = useCallback((a: Ability) => !user || canDo(user.role, a), [user]);
  const requireLogin = useCallback(() => {
    if (user) return false;
    setCreating({ kind: 'login', values: {} });
    notify('Войдите, чтобы выполнить операцию', 'err');
    return true;
  }, [user, notify]);

  const online = !data.sync || data.sync.status === 'ok';
  const needsLink = useCallback((resource: string) => !online && !OFFLINE_RESOURCES.includes(resource), [online]);

  const create = useCallback((kind: CreateKind, values: Record<string, string> = {}) => {
    if (kind !== 'login' && !user) { setCreating({ kind: 'login', values: {} }); notify('Войдите, чтобы выполнить операцию', 'err'); return; }
    if (!online && !OFFLINE_FORMS.includes(kind)) { notify(NEED_LINK, 'err'); return; }
    setDrawer(null);
    setCreating({ kind, values });
  }, [user, notify, online]);

  const post = useCallback(async (resource: string, body: Record<string, unknown>): Promise<PostResult> => {
    if (!user) { requireLogin(); return { ok: false, message: 'Войдите, чтобы выполнить операцию' }; }
    if (needsLink(resource)) return { ok: false, message: NEED_LINK };
    try {
      // Ключ операции: если ответ потерялся и запрос повторят, сервер не выполнит команду второй раз.
      const res = await fetch(`/api/v1/${resource}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newOpKey() }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: json.error?.message || 'Операция не выполнена' };
      // Десктоп: сохранено в очереди без ответа сервера или сервер счёл операцию спорной.
      if (json.sync === 'queued') notify('Сохранено на ноутбуке — отправится на сервер автоматически');
      if (json.sync === 'conflict') notify(`Требует решения: ${json.warning}`, 'err');
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, message: 'Нет связи с сервером. Проверьте соединение и повторите.' };
    }
  }, [user, requireLogin, refresh, needsLink, notify]);

  // После выхода данные организации не остаются на экране: уходим на страницу входа.
  const logout = useCallback(async () => { await fetch('/api/auth', { method: 'DELETE' }); setUser(null); window.location.assign('/login'); }, []);

  const openDrawer = useCallback((ref: NonNullable<DrawerRef>) => setDrawer(ref), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openPalette = useCallback(() => setPalette(true), []);

  const ctx: Erp = useMemo(() => ({ data, user, today, scopeId, setScope, nav, go, openProject, drawer, openDrawer, closeDrawer, create, refresh, post, notify, can, requireLogin, openPalette, density, setDensity, theme, setTheme, logout, isPhone, online, needsLink }),
    [data, user, today, scopeId, setScope, nav, go, openProject, drawer, openDrawer, closeDrawer, create, refresh, post, notify, can, requireLogin, openPalette, density, setDensity, theme, setTheme, logout, isPhone, online, needsLink]);

  const project = data.projects.find(p => p.id === scopeId);
  const pending = data.metrics.openRequests + data.metrics.delayedPurchases;
  const isUserAdmin = Boolean(user && USER_ADMINS.includes(user.role));
  const subOptions = subs[nav.view]?.filter(o => (o.value !== 'users' || isUserAdmin) && (data.sync || !DESKTOP_SUBS.includes(o.value)));
  const openConflicts = data.conflicts.filter(c => c.status === 'open').length;
  const showSub = subOptions && !(nav.view === 'projects' && project && nav.sub !== 'schedule');

  let content: React.ReactNode;
  if (nav.view === 'today') content = isPhone || nav.sub === 'foreman' ? <ForemanView /> : <TodayView />;
  else if (nav.view === 'projects') content = nav.sub === 'schedule' ? <PlanView /> : project ? <ProjectView key={project.id} project={project} /> : <ProjectsPage />;
  else if (nav.view === 'money') content = <MoneyView sub={nav.sub || 'plan'} />;
  else if (nav.view === 'supply') content = nav.sub === 'warehouse' ? <WarehouseView /> : <ProcurementView />;
  else if (nav.view === 'sync') content = <SyncView sub={data.sync || !DESKTOP_SUBS.includes(nav.sub) ? nav.sub || 'conflicts' : 'conflicts'} />;
  else if (nav.sub === 'users' && isUserAdmin) content = <UsersView />;
  else content = <RefsView sub={nav.sub || 'materials'} />;

  return (
    <ErpContext.Provider value={ctx}>
      <div className="app" data-rail={railWide ? 'wide' : 'narrow'}>
        <a className="skip" href="#main">К содержимому</a>
        <nav className="rail" aria-label="Разделы">
          <div className="rail-brand" title={BRAND.name}><span className="brand-mark disp" aria-hidden="true">{BRAND.name[0]}</span><span className="rail-brand-text"><b className="disp">{BRAND.name}</b><small>{BRAND.product}</small></span></div>
          <ul>
            {railItems.map(it => {
              const active = nav.view === it.view;
              return (
                <li key={it.view}>
                  <button type="button" className="rail-item" aria-current={active ? 'page' : undefined} data-tip={it.label} onClick={() => go(it.view, it.sub)}>
                    <it.icon size={20} aria-hidden="true" />
                    <span className="rail-label">{it.label}</span>
                    {it.view === 'today' && pending > 0 && <span className="rail-badge" aria-label={`${pending} требуют внимания`}>{pending}</span>}
                    {it.view === 'sync' && openConflicts > 0 && <span className="rail-badge" aria-label={`${openConflicts} спорных операций`}>{openConflicts}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="rail-toggle" onClick={toggleRail} aria-label={railWide ? 'Свернуть меню' : 'Развернуть меню'} data-tip={railWide ? 'Свернуть' : 'Развернуть'}>{railWide ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>
        </nav>

        <header className="ctxbar">
          <div className="ctx-scope">
            <label htmlFor="scope" className="sr-only">Объект</label>
            <select id="scope" value={scopeId} onChange={e => { const id = e.target.value; if (id) { if (nav.view === 'projects' && nav.sub !== 'schedule') openProject(id); else setScope(id); } else { setScope(''); } }}>
              <option value="">Все объекты</option>
              {data.projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </div>
          <button type="button" className="ctx-search" onClick={openPalette} aria-label="Найти или выполнить действие (Ctrl K)">
            <Search size={16} aria-hidden="true" /><span>Найти объект, заявку, действие…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="ctx-tools">
            {data.sync ? <DesktopSync sync={data.sync} /> : (
            <span className="ctx-sync hide-phone" role="status" data-live={live ? 'on' : 'off'} title={live ? 'Изменения других пользователей появляются автоматически' : 'Нет соединения для автообновления: данные обновляются раз в 30 секунд'}>
              {live ? 'Онлайн' : 'Автообновление недоступно'}{syncedAt && <> · обновлено {syncedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</>}
            </span>)}
            <button type="button" className="icon-btn hide-phone" aria-pressed={density === 'comfortable'} aria-label={density === 'comfortable' ? 'Плотность: комфортно' : 'Плотность: компактно'} data-tip={density === 'comfortable' ? 'Комфортно (44 px)' : 'Компактно (34 px)'} onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}>{density === 'comfortable' ? <Rows3 size={18} /> : <Rows4 size={18} />}</button>
            <button type="button" className="icon-btn" aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} data-tip={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
            {user ? (
              <div className="ctx-user"><span className="ctx-user-text"><b>{user.name}</b><small>{roleLabel[user.role] || user.role}</small></span><a className="icon-btn" href="/account/password" aria-label="Сменить пароль" data-tip="Сменить пароль"><KeyRound size={18} /></a>{!data.sync && <button type="button" className="icon-btn" aria-label="Выйти из системы" data-tip="Выйти" onClick={logout}><LogOut size={18} /></button>}</div>
            ) : (
              <button type="button" className="btn" onClick={() => setCreating({ kind: 'login', values: {} })}><LogIn size={16} aria-hidden="true" />Войти</button>
            )}
          </div>
        </header>

        <main id="main" className="main" ref={mainRef} tabIndex={-1}>
          {showSub && subOptions && <div className="subnav"><Segmented label="Подраздел" value={nav.sub || subOptions[0].value} onChange={v => go(nav.view, v)} options={subOptions} /></div>}
          {content}
        </main>

        {drawer && <Drawer target={drawer} />}
        {creating && <CreateDialog kind={creating.kind} initial={creating.values} onClose={() => setCreating(null)} onLogin={u => setUser(u)} />}
        {palette && <CommandPalette onClose={() => setPalette(false)} />}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map(t => <div key={t.id} className="toast" data-tone={t.tone} role={t.tone === 'err' ? 'alert' : undefined}>{t.text}</div>)}
        </div>
      </div>
    </ErpContext.Provider>
  );
}
