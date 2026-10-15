import { defineConfig } from 'drizzle-kit';
import { loadRepoDotEnv } from './src/config/dotenv.js';

loadRepoDotEnv();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://ninja:ninja_dev_password@127.0.0.1:5432/ninja',
  },
});
