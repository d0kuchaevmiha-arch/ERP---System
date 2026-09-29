import { NextRequest } from 'next/server';
import { organizations, projects, tasks, budgetLines, expenses, materials, warehouses, stockMovements, purchases, counterparties, contracts, approvals } from '@/db/schema';
import { userFromRequest } from '@/server/http/request-user';
import { httpCommands } from '@/server/domain/registry';
import { commandResponse, errorResponse as error } from '@/server/http/command-route';
import { getOverview } from '@/lib/overview';

export const dynamic = 'force-dynamic';
const tables = { organizations, projects, tasks, budgets: budgetLines, expenses, materials, warehouses, suppliers: counterparties, contracts, purchases, movements: stockMovements, approvals };
export async function GET(req: NextRequest, { params }: { params: Promise<{resource:string}> }) {
  const { resource } = await params;
  // Без входа данные не отдаются никогда (§5.2.2); сводка — только в пределах организации и доступных объектов.
  const user = (await userFromRequest(req))?.user; if (!user) return error('Войдите в систему',401);
  if (user.mustChangePassword) return error('Смените пароль, чтобы продолжить',403);
  if (resource === 'overview') { try { return Response.json(await getOverview(user)); } catch { return error('Данные пока недоступны. Примените миграции БД и загрузите демонстрационные данные.',503); } }
  if (!(resource in tables)) return error('Ресурс не найден',404);
  const data = await getOverview(user);
  const key = resource === 'suppliers' ? 'counterparties' : resource === 'budgets' ? 'budgets' : resource === 'movements' ? 'movements' : resource;
  const items = (data as unknown as Record<string, unknown[]>)[key] || [];
  const search = (req.nextUrl.searchParams.get('search') || '').toLowerCase(); const projectId = req.nextUrl.searchParams.get('projectId');
  const filtered = items.filter(x => { const row = x as Record<string,unknown>; return (!search || JSON.stringify(row).toLowerCase().includes(search)) && (!projectId || row.projectId === projectId) && (resource !== 'suppliers' || row.kind === 'supplier'); });
  const page = Math.max(1,Number(req.nextUrl.searchParams.get('page')) || 1), limit = Math.min(100,Math.max(1,Number(req.nextUrl.searchParams.get('limit')) || 20));
  return Response.json({ data: filtered.slice((page-1)*limit,page*limit), total: filtered.length, page, limit });
}
// Вся запись — через доменные команды (роль → Zod → authorize → транзакция → аудит).
export async function POST(req: NextRequest, { params }: { params: Promise<{resource:string}> }) {
  const { resource } = await params;
  const name = httpCommands[resource]; if (!name) return error('Ресурс не найден',404);
  return commandResponse(req, name, body => body);
}
