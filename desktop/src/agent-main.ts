import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { SyncAgent } from '@/client/sync/agent';
import { HttpTransport } from '@/client/sync/http-transport';
import { startSyncLoop } from '@/client/sync/runner';
import { AGENT_CHANNEL } from '@/client/local/forward';

// Процесс sync-agent десктопа (§3): отдельный Node через ELECTRON_RUN_AS_NODE, работает с локальной репликой.
const { DATABASE_URL, ERP_SERVER_URL, ERP_DEVICE_TOKEN } = process.env;
if (!DATABASE_URL || !ERP_SERVER_URL || !ERP_DEVICE_TOKEN) { console.error('agent: нет DATABASE_URL / ERP_SERVER_URL / ERP_DEVICE_TOKEN'); process.exit(2); }

const log = (m: string) => console.log(`[agent] ${m}`);
const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
pool.on('error', e => log(`pool: ${e.message}`));
const transport = new HttpTransport(ERP_SERVER_URL, ERP_DEVICE_TOKEN);
const agent = new SyncAgent({ db: drizzle(pool), transport, log, onProgress: p => { if (p.phase === 'snapshot') log(`загрузка ${p.entity}: ${p.rows}`); } });
const loop = startSyncLoop({ agent, transport, log });

// Локальный Next будит агента после записи и при смене «Доступно офлайн».
const wake = new Client({ connectionString: DATABASE_URL });
wake.on('notification', () => loop.nudge());
wake.on('error', e => log(`wake: ${e.message}`));
void wake.connect().then(() => wake.query(`listen ${AGENT_CHANNEL}`)).catch(e => log(`wake: ${(e as Error).message}`));

async function shutdown() {
  await loop.stop();
  await wake.end().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
log(`запущен, сервер ${ERP_SERVER_URL}`);
