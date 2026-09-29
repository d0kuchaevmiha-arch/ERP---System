import { getOverview } from '@/lib/overview';
import { requirePageUser } from '@/lib/page-session';
import Workspace from '@/components/workspace';
import { SystemScreen } from '@/components/erp/system-screen';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function ProjectPage({params}:{params:Promise<{id:string}>}) {
  const {id} = await params;
  const session = await requirePageUser();
  if ('error' in session) return <SystemScreen title="Сервер не готов">{session.error}</SystemScreen>;
  const { user } = session;
  const data = await getOverview(user);
  // Чужой или недоступный объект неотличим от несуществующего.
  if(!data.projects.some(p=>p.id===id)) notFound();
  return <Workspace initial={data} currentUser={{name:user.name,role:user.role,email:user.email}} projectId={id} today={new Date().toISOString().slice(0, 10)} />;
}
