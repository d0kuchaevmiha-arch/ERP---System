// Сборка десктопа: node desktop/build.mjs [--skip-next]
// 1) esbuild: main / preload / sync-agent → desktop/dist (CommonJS для Electron);
// 2) Next standalone (DESKTOP_BUILD=1) + статика; секреты (.env) из результата удаляются — в установщик не попадают (§7).
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fs.cpSync в Node 24 молча завершает процесс, а fs.rmSync молча не удаляет на путях с кириллицей (папка проекта) —
// копируем и удаляем сами (то же, что desktop/src/fsx.ts).
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else copyFileSync(a, b);
  }
}

function removePath(p) {
  if (!existsSync(p)) return;
  if (lstatSync(p).isDirectory()) { for (const n of readdirSync(p)) removePath(path.join(p, n)); rmdirSync(p); } else unlinkSync(p);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'desktop', 'dist');
removePath(out);

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', sourcemap: 'linked', tsconfig: path.join(root, 'tsconfig.json'), external: ['electron', 'pg-native'], logLevel: 'warning' };
await build({ ...common, entryPoints: { main: 'desktop/src/main.ts', preload: 'desktop/src/preload.ts', agent: 'desktop/src/agent-main.ts' }, outdir: out, absWorkingDir: root });
console.log('desktop/dist собран');

if (!process.argv.includes('--skip-next')) {
  execSync('npx next build', { cwd: root, stdio: 'inherit', env: { ...process.env, DESKTOP_BUILD: '1' } });
  const standalone = path.join(root, '.next', 'standalone');
  // Статику Next standalone не копирует сам.
  copyDir(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'));
  if (existsSync(path.join(root, 'public'))) copyDir(path.join(root, 'public'), path.join(standalone, 'public'));
  // Next копирует .env* в standalone — секретам в установщике не место.
  for (const f of readdirSync(standalone)) if (f.startsWith('.env')) { removePath(path.join(standalone, f)); console.log(`удалён ${f} из standalone`); }
  const left = readdirSync(standalone).filter(f => f.startsWith('.env'));
  if (left.length) throw new Error(`В standalone остались секреты: ${left.join(', ')}`);
  console.log('Next standalone готов');
}
