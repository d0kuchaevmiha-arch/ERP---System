'use client';
import type { SyncStatus } from '@/client/local/status';
import { useErp } from './context';
import { plural } from './format';

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—');
const changes = (n: number) => `${n} ${plural(n, 'изменение', 'изменения', 'изменений')}`;

// Индикатор десктопа (§6.6 п. 4): «Онлайн · синхронизировано 12:04», «Офлайн · 7 изменений в очереди»,
// «Есть отклонённые (2)», «Требует решения (1)»; ссылка на выбор «Доступно офлайн».
export function DesktopSync({ sync }: { sync: SyncStatus }) {
  const { go } = useErp();
  const text = sync.status === 'ok' ? (sync.queued ? `Онлайн · отправляется ${changes(sync.queued)}` : `Онлайн · синхронизировано ${time(sync.lastPullAt)}`)
    : sync.status === 'loading' ? 'Загрузка данных с сервера…'
    : sync.status === 'revoked' ? `Устройство отозвано — подключите заново${sync.queued ? ` · ${changes(sync.queued)} не отправлено` : ''}`
    : sync.status === 'outdated' ? 'Нужно обновить приложение'
    : sync.queued ? `Офлайн · ${changes(sync.queued)} в очереди` : `Офлайн · данные на ${time(sync.lastPullAt)}`;
  return (
    <span className="ctx-sync hide-phone" role="status" data-live={sync.status === 'ok' ? 'on' : 'off'} title={sync.lastError ?? `Сервер: ${sync.serverUrl}`}>
      {sync.queued > 0 ? <button type="button" className="link" onClick={() => go('sync', 'queue')}>{text}</button> : text}
      {sync.rejected > 0 && <> · <button type="button" className="link is-over" onClick={() => go('sync', 'rejected')}>Есть отклонённые ({sync.rejected})</button></>}
      {sync.conflict > 0 && <> · <button type="button" className="link is-over" onClick={() => go('sync', 'conflicts')}>Требует решения ({sync.conflict})</button></>}
      {' · '}<a className="link" href="/offline">Доступно офлайн: {sync.effectiveScope.length}</a>
    </span>
  );
}

// Пометка строки, введённой на ноутбуке и ещё не принятой сервером (решение P4 №3), или спорной.
export function SyncMark({ id }: { id: string }) {
  const { data } = useErp();
  const s = data.sync;
  if (!s) return null;
  if (s.conflictIds.includes(id)) return <span className="tag sync-mark" data-tone="err" title="Сервер не провёл операцию автоматически: ждёт решения">спорно</span>;
  if (s.pendingIds.includes(id)) return <span className="tag sync-mark" data-tone="warn" title="Сохранено на ноутбуке, ещё не принято сервером">не синхронизировано</span>;
  return null;
}
