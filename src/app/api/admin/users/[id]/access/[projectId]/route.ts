import type { NextRequest } from 'next/server';
import { commandResponse } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string; projectId: string }> };

// PUT {permission: 'view'|'edit'} — выдать или изменить доступ; DELETE — отозвать.
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, projectId } = await params;
  return commandResponse(req, 'access.set', body => ({ ...(body as object), userId: id, projectId }));
}
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, projectId } = await params;
  return commandResponse(req, 'access.remove', () => ({ userId: id, projectId }));
}
