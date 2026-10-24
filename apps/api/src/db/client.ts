import { Pool } from "pg";

import { loadEnv } from "../env.js";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = undefined;
}
