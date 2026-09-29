import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// Файловые операции десктопа. В Node 24 на Windows fs.rmSync молча НЕ удаляет, а fs.cpSync молча завершает процесс
// на путях с кириллицей (проверено на этой машине, Node 24.12). Профиль пользователя, %TEMP% и %APPDATA% могут
// содержать кириллицу, поэтому используем простые unlink/rmdir/copyFile.

export function copyDir(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else copyFileSync(a, b);
  }
}

export function removePath(p: string) {
  if (!existsSync(p)) return;
  if (lstatSync(p).isDirectory()) {
    for (const name of readdirSync(p)) removePath(path.join(p, name));
    rmdirSync(p);
  } else unlinkSync(p);
}
