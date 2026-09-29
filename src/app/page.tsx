import { getOverview } from '@/lib/overview';
import { requirePageUser } from '@/lib/page-session';
import Workspace from '@/components/workspace';
import { SystemScreen } from '@/components/erp/system-screen';
export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await requirePageUser();
  if ('error' in session) return <SystemScreen title="Сервер не готов">{session.error}. Выполните <code>npm run db:migrate</code> и проверьте переменные окружения.</SystemScreen>;
  const { user } = session;
  let result: Awaited<ReturnType<typeof getOverview>> | null = null;
  try { result = await getOverview(user); } catch { /* база данных ещё не подготовлена */ }
  if (!result) return <SystemScreen title="База данных не подготовлена">Выполните <code>npm run db:migrate</code> и команду загрузки демо-данных из README.</SystemScreen>;
  return <Workspace initial={result} currentUser={{ name: user.name, role: user.role, email: user.email }} today={new Date().toISOString().slice(0, 10)} />;
}
