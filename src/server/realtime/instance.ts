import { db } from '@/db';
import { ChangeHub } from './hub';

// Один хаб на процесс (в dev переживает горячую перезагрузку модулей).
const g = globalThis as typeof globalThis & { __erpChangeHub?: ChangeHub };

export function getHub() {
  if (!g.__erpChangeHub) {
    // В десктопе хаб слушает локальную реплику (сигналы sync-agent); журнал там не ведётся — очистка не нужна.
    g.__erpChangeHub = new ChangeHub({ connectionString: process.env.DATABASE_URL!, db, prune: process.env.ERP_MODE !== 'client' });
    void g.__erpChangeHub.start();
  }
  return g.__erpChangeHub;
}
