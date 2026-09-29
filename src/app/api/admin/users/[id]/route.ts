import type { NextRequest } from 'next/server';
import { commandResponse } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

// Имя, роль, блокировка/разблокировка.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return commandResponse(req, 'users.update', body => ({ ...(body as object), userId: id }));
}
