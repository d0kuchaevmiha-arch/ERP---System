import { getOverview } from '@/lib/overview';
import { currentUser } from '@/lib/session';
import Workspace from '@/components/workspace';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function ProjectPage({params}:{params:Promise<{id:string}>}) {
  const {id} = await params;
  const [data,user] = await Promise.all([getOverview(),currentUser()]);
  if(process.env.ERP_PRIVATE_MODE === 'true' && !user) notFound();
  if(!data.projects.some(p=>p.id===id)) notFound();
  return <Workspace initial={data} currentUser={user ? {name:user.name,role:user.role,email:user.email}:null} projectId={id} today={new Date().toISOString().slice(0, 10)} />;
}
