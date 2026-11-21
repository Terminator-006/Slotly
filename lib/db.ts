import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { MIGRATION_SQL } from "./migrate";
import * as schema from "./schema";
import { seedDemoIfMissing } from "./seed";

/** Works for both a pooled node-postgres connection (production) and PGlite (tests, local dev). */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATION_LOCK_KEY = 727274;

/** Connect to Postgres (Neon, Supabase, local...) and make sure the schema exists. */
export async function createDb(connectionString: string): Promise<DB> {
  const pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 5) });
  const client = await pool.connect();
  try {
    // Serialise bootstrap across concurrent cold starts (CREATE EXTENSION / TABLE IF NOT EXISTS can race).
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(MIGRATION_SQL);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
  return drizzle(pool, { schema }) as unknown as DB;
}

// Loaded through a variable so the bundler and the serverless file tracer never pull the
// (large, dev-only) PGlite WebAssembly build into a production deployment.
const dynamicImport = (specifier: string) => import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);

/**
 * A real Postgres running inside this Node process (PGlite, WebAssembly). Same SQL, same
 * constraints and transactions as production, no server to install. Used by the tests and by
 * local development when DATABASE_URL is not set. Data lives in memory.
 */
export async function createPgliteDb(): Promise<DB> {
  const { PGlite } = await dynamicImport("@electric-sql/pglite");
  const { btree_gist } = await dynamicImport("@electric-sql/pglite/contrib/btree_gist");
  const { drizzle: drizzlePglite } = await dynamicImport("drizzle-orm/pglite");
  const client = new PGlite({ extensions: { btree_gist } });
  await client.exec(MIGRATION_SQL);
  return drizzlePglite(client, { schema }) as DB;
}

/** Release the connection(s) behind a DB created by createDb / createPgliteDb. */
export async function closeDb(db: DB): Promise<void> {
  const client = (db as unknown as { $client?: { end?: () => Promise<void>; close?: () => Promise<void> } }).$client;
  if (client?.end) await client.end();
  else if (client?.close) await client.close();
}

/** The SQLSTATE of a Postgres error, looking through wrapper errors (Drizzle wraps the driver's). */
function pgCode(e: unknown): string | undefined {
  for (let err: unknown = e; err instanceof Error; err = (err as { cause?: unknown }).cause) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/** 23505: a UNIQUE constraint or primary key was violated. */
export const isUniqueViolation = (e: unknown) => pgCode(e) === "23505";
/** 23P01: the bookings_no_overlap EXCLUDE constraint was violated. */
export const isExclusionViolation = (e: unknown) => pgCode(e) === "23P01";

function open(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url === "pglite://memory") return createPgliteDb();
  if (url) return createDb(url);
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Create a Postgres database (e.g. a free Neon project) and set its connection string.");
  }
  console.warn("[slotly] DATABASE_URL is not set: using an in-memory Postgres (PGlite). Data resets when the server restarts.");
  return createPgliteDb();
}

// One connection pool per server process; survives dev-server hot reloads and is reused across
// warm serverless invocations. Caching the *promise* means concurrent first requests share it.
const g = globalThis as unknown as { __slotlyDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!g.__slotlyDb) {
    const inMemory = !process.env.DATABASE_URL || process.env.DATABASE_URL === "pglite://memory";
    g.__slotlyDb = open()
      .then(async (db) => {
        if (inMemory || process.env.SLOTLY_DEMO_SEED === "1") await seedDemoIfMissing(db);
        return db;
      })
      .catch((e) => {
        g.__slotlyDb = undefined; // don't cache a failed connection forever
        throw e;
      });
  }
  return g.__slotlyDb;
}
