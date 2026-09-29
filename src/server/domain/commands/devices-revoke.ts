import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { devices, users } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { ALL_ROLES, USER_ADMIN_ROLES } from '../authz';
import { forbidden, notFound } from '../errors';
import { uuid } from '../schemas';

// Отзыв устройства (§6.1): владелец — своё, директор/администратор — любое в своей организации.
// После отзыва любой запрос с его токеном → 401; неотправленные данные клиент может экспортировать (P4).
export default defineCommand({
  name: 'devices.revoke', offline: 'online_only', roles: ALL_ROLES,
  schema: z.object({ deviceId: uuid }),
  async authorize(tx, ctx, input) {
    const [d] = await tx.select({ device: devices, orgId: users.organizationId }).from(devices).innerJoin(users, eq(users.id, devices.userId))
      .where(and(eq(devices.id, input.deviceId), eq(users.organizationId, ctx.actor.organizationId))).for('update', { of: devices });
    if (!d) throw notFound('Устройство не найдено');
    if (d.device.userId !== ctx.actor.id && !(USER_ADMIN_ROLES as readonly string[]).includes(ctx.actor.role)) throw forbidden('Отозвать чужое устройство может директор или администратор');
    return d.device;
  },
  async execute(tx, ctx, _input, device) {
    if (device.revokedAt) return { id: device.id, revokedAt: device.revokedAt };
    const [row] = await tx.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, device.id)).returning({ id: devices.id, revokedAt: devices.revokedAt });
    await audit(tx, ctx, 'revoke_device', 'device', device.id, { name: device.name }, { revokedAt: row.revokedAt });
    return row;
  },
});
