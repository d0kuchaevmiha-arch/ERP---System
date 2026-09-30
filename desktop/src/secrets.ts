import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { removePath } from './fsx';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeStorage } from 'electron';
import type { Verifier } from '@/client/offline/local-auth';

// Секреты десктопа (§7): пароль локальной БД и токен устройства. Хранятся через safeStorage (DPAPI Windows) —
// расшифровать может только тот же пользователь Windows на этом компьютере. В установщик ничего не попадает.
export type Device = { deviceId: string; token: string; userId: string; organizationId: string; role: string; name: string; serverUrl: string; email?: string };
// verifier — офлайн-проверка пароля (scrypt, решение P4 №11); сам пароль не хранится.
export type Secrets = { dbPassword: string; device: Device | null; verifier?: Verifier | null };

export function loadSecrets(file: string): Secrets {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows (DPAPI) недоступно — секреты хранить нельзя');
  if (existsSync(file)) return JSON.parse(safeStorage.decryptString(readFileSync(file))) as Secrets;
  const fresh: Secrets = { dbPassword: randomBytes(24).toString('base64url'), device: null };
  saveSecrets(file, fresh);
  return fresh;
}

export function saveSecrets(file: string, s: Secrets) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, safeStorage.encryptString(JSON.stringify(s)));
}

export function forgetDevice(file: string) {
  if (!existsSync(file)) return;
  const s = loadSecrets(file);
  saveSecrets(file, { ...s, device: null, verifier: null });
}

export const removeSecrets = (file: string) => removePath(file);
