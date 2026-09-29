import { Pool } from 'pg';
import { runMigrations } from '../src/server/db/migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: url, max: 2 });
runMigrations(pool).catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool.end());
