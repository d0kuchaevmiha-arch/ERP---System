import type { NextRequest } from 'next/server';
import { commandResponse } from '@/server/http/command-route';

export const dynamic = 'force-dynamic';

// Отозвать устройство: владелец — своё, director/super_admin — любое в своей организации.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return commandResponse(req, 'devices.revoke', () => ({ deviceId: id }));
}
