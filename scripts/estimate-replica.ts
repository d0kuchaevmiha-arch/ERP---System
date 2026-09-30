// Оценка объёма реплики десктопа по текущей серверной БД (§10).
// npx tsx --env-file=.env scripts/estimate-replica.ts   (в контейнере: docker compose exec app npx tsx scripts/estimate-replica.ts)
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { INDEX_FACTOR, TARGET_BYTES, estimateAll } from '../src/server/sync/estimate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: url, max: 2 });
const mb = (b: number) => (b / 1024 / 1024).toFixed(2);

estimateAll(drizzle(pool)).then(rows => {
  console.log(`Оценка реплики (данные × ${INDEX_FACTOR} на индексы; ориентир ${mb(TARGET_BYTES)} МБ)\n`);
  console.log(['Пользователь', 'Роль', 'Объектов', 'Строк', 'Данные, МБ', 'Оценка, МБ', ''].join('\t'));
  for (const r of rows) {
    const rowsTotal = r.entities.reduce((n, e) => n + e.rows, 0);
    console.log([r.user.name, r.user.role + (r.user.orgWide ? ' (все объекты)' : ''), r.projects, rowsTotal, mb(r.dataBytes), mb(r.estimatedBytes), r.estimatedBytes > TARGET_BYTES ? 'ВЫШЕ ОРИЕНТИРА' : ''].join('\t'));
  }
  const worst = rows[0];
  if (worst) {
    console.log(`\nНаибольшая реплика — ${worst.user.name}; по сущностям:`);
    for (const e of worst.entities.filter(x => x.rows).sort((a, b) => b.bytes - a.bytes)) console.log(`  ${e.entity}\t${e.rows} строк\t${mb(e.bytes)} МБ`);
  }
}).catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
