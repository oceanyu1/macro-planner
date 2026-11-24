import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

// Reuse one client across hot reloads in dev.
const g = globalThis as unknown as { __db?: DB };

function connect(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  // prepare: false is required for Supabase's transaction pooler (port 6543),
  // which is what serverless functions on Vercel should connect through.
  const client = postgres(url, { prepare: false, max: 5 });
  return drizzle(client, { schema });
}

/** Lazily connects on first query, so `next build` works without a database. */
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    g.__db ??= connect();
    return Reflect.get(g.__db, prop, g.__db);
  },
});

export { schema };
