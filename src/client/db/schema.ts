import { pgTable, integer, text, uuid, bigint, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';

// Таблицы только десктоп-клиента (§4.3). Миграции — drizzle-client/, на сервере их нет.
// Реплика серверных таблиц — та же схема src/db/schema.ts и те же миграции drizzle/.

const tz = (name: string) => timestamp(name, { withTimezone: true });

// Состояние синхронизации — одна строка (id = 1).
export const syncState = pgTable('sync_state', {
  id: integer('id').primaryKey().default(1),
  serverUrl: text('server_url').notNull(),
  deviceId: uuid('device_id').notNull(),
  userId: uuid('user_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  // Роль при последнем snapshot: смена роли меняет видимость — нужна повторная загрузка.
  userRole: text('user_role').notNull(),
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
  lastPullAt: tz('last_pull_at'),
  lastPushAt: tz('last_push_at'),
  protocolVersion: integer('protocol_version').notNull().default(1),
  // Выбранный пользователем офлайн-набор; NULL — набор по умолчанию (§10).
  offlineScope: jsonb('offline_scope').$type<string[] | null>(),
  // Объекты, которые реально лежат в реплике (последний scope сервера).
  effectiveScope: jsonb('effective_scope').$type<string[]>().notNull().default([]),
  snapshotRequired: boolean('snapshot_required').notNull().default(true),
  // 'ok' | 'offline' | 'revoked' | 'error' — для индикатора в шапке.
  status: text('status').notNull().default('ok'),
  lastError: text('last_error'),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});
