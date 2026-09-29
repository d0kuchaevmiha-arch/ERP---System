'use client';
import type { SyncStatus } from '@/client/local/status';

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—');

// Индикатор десктопа (§6.6 п. 4): состояние реплики и ссылка на выбор «Доступно офлайн».
export function DesktopSync({ sync }: { sync: SyncStatus }) {
  const text = sync.status === 'ok' ? `Синхронизировано ${time(sync.lastPullAt)}`
    : sync.status === 'loading' ? 'Загрузка данных с сервера…'
    : sync.status === 'revoked' ? 'Устройство отозвано — подключите заново'
    : sync.status === 'outdated' ? 'Нужно обновить приложение'
    : `Нет связи · данные на ${time(sync.lastPullAt)}`;
  return (
    <span className="ctx-sync hide-phone" role="status" data-live={sync.status === 'ok' ? 'on' : 'off'} title={sync.lastError ?? `Сервер: ${sync.serverUrl}`}>
      {text} · <a className="link" href="/offline">Доступно офлайн: {sync.effectiveScope.length}</a>
    </span>
  );
}
