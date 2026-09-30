// Проверка собранного десктопа (§7): в установщик не попадают .env, ключи и значения секретов разработчика.
// node scripts/check-desktop-package.mjs [dist-desktop/win-unpacked]
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { extractAll } from '@electron/asar';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = path.resolve(process.argv[2] ?? 'dist-desktop/win-unpacked');
if (!existsSync(root)) { console.error(`Нет каталога ${root} — сначала npm run dist`); process.exit(2); }

// Значения секретов из локального .env (если есть) — их не должно быть ни в одном файле сборки.
const secrets = [];
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^(SESSION_SECRET|POSTGRES_PASSWORD|DEMO_PASSWORD|DATABASE_URL)=(.+)$/.exec(line);
    if (m && m[2].length >= 8) secrets.push({ name: m[1], value: m[2] });
  }
}
const forbiddenName = /(^\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|^secrets\.bin$|^id_rsa)/i;

const problems = [];
function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // Ссылки (junction) на каталоги в node_modules Next: тип — по statSync, а не по записи каталога.
    if (statSync(p).isDirectory()) { scan(p); continue; }
    if (forbiddenName.test(e.name)) problems.push(`запрещённый файл: ${path.relative(root, p)}`);
    if (e.name.endsWith('.asar')) { const x = mkdtempSync(path.join(tmpdir(), 'asar-')); extractAll(p, x); scanExtracted(x, path.relative(root, p)); continue; }
    checkContent(p, path.relative(root, p));
  }
}
function scanExtracted(dir, label) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (statSync(p).isDirectory()) scanExtracted(p, label);
    else { if (forbiddenName.test(e.name)) problems.push(`запрещённый файл в ${label}: ${e.name}`); checkContent(p, `${label}:${e.name}`); }
  }
}
function checkContent(p, label) {
  if (!secrets.length || statSync(p).size > 50 * 1024 * 1024) return;
  const buf = readFileSync(p);
  for (const s of secrets) if (buf.includes(s.value)) problems.push(`значение ${s.name} найдено в ${label}`);
}

scan(root);
if (problems.length) { console.error('ПРОВЕРКА НЕ ПРОЙДЕНА:\n' + problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log(`OK: ${root} — нет .env/ключей и значений секретов (${secrets.map(s => s.name).join(', ') || 'нет .env для сверки'})`);
