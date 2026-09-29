import type { NextRequest } from 'next/server';
import { commandResponse } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return commandResponse(req, 'users.resetPassword', () => ({ userId: id }));
}
