import { NextRequest } from 'next/server';
import { db } from '@/db';
import { organizations, projects, tasks, budgetLines, expenses, materials, warehouses, stockMovements, purchases, counterparties, contracts, approvals } from '@/db/schema';
import { currentUser } from '@/lib/session';
import { runCommand, httpCommands } from '@/server/domain/registry';
import { DomainError, invalid } from '@/server/domain/errors';
import { clientIp } from '@/server/http/client-ip';
import { getOverview } from '@/lib/overview';

export const dynamic = 'force-dynamic';
const tables = { organizations, projects, tasks, budgets: budgetLines, expenses, materials, warehouses, suppliers: counterparties, contracts, purchases, movements: stockMovements, approvals };
function error(message: string, status = 400) { return Response.json({ error: { message } }, { status }); }
export async function GET(req: NextRequest, { params }: { params: Promise<{resource:string}> }) {
  const { resource } = await params;
  if (resource === 'overview') { if(process.env.ERP_PRIVATE_MODE === 'true' && !await currentUser()) return error('Войдите в систему',401); try { return Response.json(await getOverview()); } catch { return error('Данные пока недоступны. Примените схему БД и загрузите демонстрационные данные.',503); } }
  if (!(resource in tables)) return error('Ресурс не найден',404);
  const user = await currentUser(); if (!user) return error('Войдите в систему',401);
  const data = await getOverview();
  const key = resource === 'suppliers' ? 'counterparties' : resource === 'budgets' ? 'budgets' : resource === 'movements' ? 'movements' : resource;
  const items = (data as unknown as Record<string, unknown[]>)[key] || [];
  const search = (req.nextUrl.searchParams.get('search') || '').toLowerCase(); const projectId = req.nextUrl.searchParams.get('projectId');
  const filtered = items.filter(x => { const row = x as Record<string,unknown>; return (!search || JSON.stringify(row).toLowerCase().includes(search)) && (!projectId || row.projectId === projectId) && (resource !== 'suppliers' || row.kind === 'supplier'); });
  const page = Math.max(1,Number(req.nextUrl.searchParams.get('page')) || 1), limit = Math.min(100,Math.max(1,Number(req.nextUrl.searchParams.get('limit')) || 20));
  return Response.json({ data: filtered.slice((page-1)*limit,page*limit), total: filtered.length, page, limit });
}
export async function POST(req: NextRequest, { params }: { params: Promise<{resource:string}> }) {
  const { resource } = await params;
  const origin = req.headers.get('origin'); if(origin && origin !== req.nextUrl.origin) return error('Недопустимый источник запроса',403);
  const user = await currentUser(); if (!user) return error('Войдите в систему',401);
  const name = httpCommands[resource]; if (!name) return error('Ресурс не найден',404);
  try {
    const body = await req.json().catch(() => { throw invalid('Тело запроса должно быть JSON'); });
    const data = await runCommand({ db, actor: user, ip: clientIp(req.headers), userAgent: req.headers.get('user-agent') }, name, body);
    return Response.json({data},{status:201});
  } catch(e) { if(e instanceof DomainError) return error(e.message,e.status); return error(e instanceof Error ? e.message : 'Ошибка операции',400); }
}
