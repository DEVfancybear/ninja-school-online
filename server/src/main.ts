import { createApp } from './app.js';
import { loadRepoDotEnv } from './config/dotenv.js';
import { loadEnv } from './config/env.js';
import { createDb, createPool } from './db/client.js';

loadRepoDotEnv();
const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);

let app: Awaited<ReturnType<typeof createApp>>;
try {
  app = await createApp({ env, db });
} catch (error) {
  // Không dựng được app: thường là game-data sai (GameDataError đã ghi rõ file + trường).
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exit(1);
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`nhận ${signal}, đang dừng server`);
  await app.close();
  await pool.end();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
