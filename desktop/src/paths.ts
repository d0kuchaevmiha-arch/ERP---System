import path from 'node:path';
import { app } from 'electron';

// Где что лежит (§3, §8). Данные — %APPDATA%\ERP-Energotech и не удаляются при удалении программы.
export const APP_DIR_NAME = 'ERP-Energotech';
export const PG_VERSION = '16.14';

export function dataPaths() {
  // ERP_DATA_DIR — только для автотестов и диагностики (отдельный каталог данных).
  const root = process.env.ERP_DATA_DIR || path.join(app.getPath('appData'), APP_DIR_NAME);
  return {
    root,
    pgdata: path.join(root, 'pgdata'),
    backups: path.join(root, 'backups'),
    logs: path.join(root, 'logs'),
    config: path.join(root, 'config.json'),
    secrets: path.join(root, 'secrets.bin'),
  };
}

// Ресурсы приложения: в установленной программе — resources\app-files, при разработке — корень репозитория.
export function resourcePaths() {
  const packaged = app.isPackaged;
  const res = packaged ? path.join(process.resourcesPath, 'app-files') : path.resolve(__dirname, '..', '..');
  return {
    root: res,
    pgHome: packaged ? path.join(process.resourcesPath, 'pgsql') : path.join(res, 'node_modules', '@embedded-postgres', 'windows-x64', 'native'),
    nextServer: path.join(res, packaged ? 'next' : '.next/standalone', 'server.js'),
    agent: path.join(__dirname, 'agent.js'),
    ui: path.join(__dirname, '..', 'ui'),
  };
}
