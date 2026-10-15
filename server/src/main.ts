import { createApp } from './app.js';
import { loadRepoDotEnv } from './config/dotenv.js';
import { loadEnv } from './config/env.js';
import { createDb, createPool } from './db/client.js';

loadRepoDotEnv();
const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);
const app = await createApp({ env, db });

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
