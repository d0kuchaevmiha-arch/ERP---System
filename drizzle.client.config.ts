import { defineConfig } from 'drizzle-kit';
// Миграции таблиц только десктоп-клиента (§4.3): npx drizzle-kit generate --config drizzle.client.config.ts
export default defineConfig({ schema: './src/client/db/schema.ts', out: './drizzle-client', dialect: 'postgresql' });
