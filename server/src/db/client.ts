import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

/** Tạo pool kết nối PostgreSQL. */
export function createPool(databaseUrl: string, maxConnections = 10): Pool {
  return new Pool({ connectionString: databaseUrl, max: maxConnections });
}

/** Tạo lớp truy vấn Drizzle trên một pool. */
export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
