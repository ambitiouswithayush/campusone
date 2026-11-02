import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    return drizzle(pool, { schema }) as unknown as DB;
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is required on Vercel — the embedded database cannot persist on serverless functions.");
  }
  // Zero-install local mode: real Postgres compiled to WASM, persisted to ./.data
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? "./.data/pglite";
  if (dir !== "memory://") {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
  }
  const client = new PGlite(dir);
  return drizzle(client, { schema }) as unknown as DB;
}

/** One connection per process; survives Next.js hot reloads in dev. */
export function getDb(): Promise<DB> {
  if (!globalForDb.__db) globalForDb.__db = connect();
  return globalForDb.__db;
}

export { schema };
