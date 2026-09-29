import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';
export default defineConfig({schema:'./src/db/schema.ts',out:'./drizzle',dialect:'postgresql',dbCredentials:{url:process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/app_db'}});
