import { getOverview } from '@/lib/overview';
import { currentUser } from '@/lib/session';
import Workspace from '@/components/workspace';
import { BRAND } from '@/lib/brand';
export const dynamic = 'force-dynamic';

function SystemScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="sys">
      <section className="stamp sys-stamp" aria-labelledby="sys-title">
        <div className="stamp-cell stamp-code"><small>Система</small><b className="disp">{BRAND.name}</b></div>
        <div className="stamp-cell stamp-name"><small>Состояние</small><h1 id="sys-title" className="disp">{title}</h1><span>{children}</span></div>
      </section>
    </main>
  );
}

export default async function Home() {
  let result: Awaited<ReturnType<typeof getOverview>> | null = null;
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try { [result, user] = await Promise.all([getOverview(), currentUser()]); } catch { /* база данных ещё не подготовлена */ }
  if (!result) return <SystemScreen title="База данных не подготовлена">Выполните <code>npx drizzle-kit push</code> и команду загрузки демо-данных из README.</SystemScreen>;
  if (process.env.ERP_PRIVATE_MODE === 'true' && !user) return <SystemScreen title="Требуется вход">Для доступа к данным войдите в систему. <a href="/login">Перейти ко входу</a></SystemScreen>;
  return <Workspace initial={result} currentUser={user ? { name: user.name, role: user.role, email: user.email } : null} today={new Date().toISOString().slice(0, 10)} />;
}
