import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

const g = globalThis as unknown as { __pool?: Pool };

export function pool(): Pool {
  if (!g.__pool) {
    g.__pool = new Pool({
      connectionString: env.databaseUrl,
      max: 10,
      ssl: process.env.DATABASE_SSL === "1" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return g.__pool;
}

export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query<T>(text, params as any[]);
  return r.rows;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
