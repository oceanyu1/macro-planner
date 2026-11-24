import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type DB = NodePgDatabase<typeof schema>;

// Reuse one pool per function instance (and across hot reloads in dev).
const g = globalThis as unknown as { __db?: DB };

/*
 * Why node-postgres and not postgres.js: postgres.js pipelines concurrent queries
 * on one socket. When Vercel suspends a function mid-pipeline (e.g. a cancelled
 * prefetch), Supabase's transaction pooler is left holding a half-sent query; it
 * sits "active / ClientRead" until the 2-minute statement timeout, and that late
 * error crashes the function on its next wake. pg sends one query per connection
 * at a time, and attachDatabasePool closes idle connections before suspension.
 */
function connect(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000, // fail fast instead of hanging for Postgres's 2-minute timeout
    ssl: { rejectUnauthorized: false }, // encrypt; Supabase's pooler cert isn't in Node's CA store
  });
  // A dropped idle connection must not crash the process.
  pool.on("error", (err) => console.error("pg pool error:", err.message));
  attachDatabasePool(pool);
  return drizzle({ client: pool, schema });
}

/** Lazily connects on first query, so `next build` works without a database. */
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    g.__db ??= connect();
    return Reflect.get(g.__db, prop, g.__db);
  },
});

export { schema };
