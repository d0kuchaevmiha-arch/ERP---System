import { pgTable, integer, text, uuid, bigint, bigserial, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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

// Очередь операций, введённых на ноутбуке (§4.3, §6.6). Пока операция не принята сервером, это единственная копия
// введённых данных — поэтому отклонённые не удаляются, а только скрываются (после экспорта).
// status: pending → sending → applied | rejected | conflict (conflict → applied | rejected после разбора).
export const outbox = pgTable('outbox', {
  opId: uuid('op_id').primaryKey(),
  // Порядок ввода — порядок отправки.
  seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
  command: text('command').notNull(),
  payload: jsonb('payload').notNull(),
  deviceCreatedAt: tz('device_created_at').notNull(),
  status: text('status').notNull().default('pending'),
  // Id основной строки, созданной операцией (та же строка на сервере).
  entityId: uuid('entity_id'),
  dependsOn: uuid('depends_on').array().notNull().default(sql`'{}'::uuid[]`),
  errorCode: text('error_code'),
  error: text('error'),
  conflictId: uuid('conflict_id'),
  attempts: integer('attempts').notNull().default(0),
  hidden: boolean('hidden').notNull().default(false),
  sentAt: tz('sent_at'),
  settledAt: tz('settled_at'),
}, t => [index('outbox_status_idx').on(t.status, t.seq)]);

// Оптимистичные строки реплики, записанные операцией (§4.3): для отката при отказе и пометки «не синхронизировано».
// before — строка до изменения в формате pull (NULL — строку создала операция, откат = удаление).
export const localRows = pgTable('local_rows', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  opId: uuid('op_id').notNull().references(() => outbox.opId),
  entity: text('entity').notNull(),
  entityId: uuid('entity_id').notNull(),
  before: jsonb('before'),
}, t => [index('local_rows_op_idx').on(t.opId), index('local_rows_entity_idx').on(t.entity, t.entityId)]);
