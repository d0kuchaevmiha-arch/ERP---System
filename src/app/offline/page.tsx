import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requirePageUser } from '@/lib/page-session';
import { clientEnv, isClientMode } from '@/client/local/session';
import { localSyncStatus } from '@/client/local/status';
import { HttpTransport } from '@/client/sync/http-transport';
import { SystemScreen } from '@/components/erp/system-screen';
import { OfflineScopeForm } from './form';

export const dynamic = 'force-dynamic';

// Десктоп: выбор объектов «Доступно офлайн» (§10). Список доступных объектов — с сервера (нужна связь).
export default async function OfflinePage() {
  if (!isClientMode()) notFound();
  const session = await requirePageUser();
  if ('error' in session) return <SystemScreen title="Приложение не готово">{session.error}</SystemScreen>;
  const env = clientEnv();
  const status = await localSyncStatus(db);
  let info: Awaited<ReturnType<HttpTransport['scope']>> | null = null;
  try { info = await new HttpTransport(env.serverUrl, env.token, 10_000).scope(); } catch { /* нет связи */ }
  if (!info) return <SystemScreen title="Нужна связь с сервером">Список объектов загружается с сервера организации. Проверьте подключение и откройте страницу снова. <Link href="/">Вернуться</Link></SystemScreen>;
  return <OfflineScopeForm available={info.available} selected={status?.offlineScope ?? null} defaultScope={info.defaultScope} orgWide={info.orgWide} />;
}
