import { db } from '@/db';
import { ChangeHub } from './hub';

// Один хаб на процесс (в dev переживает горячую перезагрузку модулей).
const g = globalThis as typeof globalThis & { __erpChangeHub?: ChangeHub };

export function getHub() {
  if (!g.__erpChangeHub) {
    g.__erpChangeHub = new ChangeHub({ connectionString: process.env.DATABASE_URL!, db });
    void g.__erpChangeHub.start();
  }
  return g.__erpChangeHub;
}
