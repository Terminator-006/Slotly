import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { MIGRATION_SQL } from "./migrate";
import { seedDemoIfEmpty } from "./seed";

export type DB = BetterSQLite3Database<typeof schema>;

/** Open (and migrate) a database. Pass ":memory:" for tests. */
export function createDb(filename: string): DB {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // If another process holds the write lock, wait instead of failing instantly.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(MIGRATION_SQL);
  return drizzle(sqlite, { schema });
}

/** True for SQLITE_CONSTRAINT_* errors (unique, check, FK), including ones wrapped by drizzle. */
export function isConstraintError(e: unknown): boolean {
  for (let err: unknown = e; err instanceof Error; err = (err as { cause?: unknown }).cause) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) return true;
  }
  return false;
}

function defaultPath(): string {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  // Vercel's filesystem is read-only except /tmp (ephemeral: fine for a portfolio demo).
  if (process.env.VERCEL) return "/tmp/slotly.db";
  return path.join(process.cwd(), "data", "slotly.db");
}

// One connection per server process; survives dev-server hot reloads.
const g = globalThis as unknown as { __slotlyDb?: DB };

export function getDb(): DB {
  if (!g.__slotlyDb) {
    const db = createDb(defaultPath());
    if (process.env.SLOTLY_DEMO_SEED === "1") seedDemoIfEmpty(db);
    g.__slotlyDb = db;
  }
  return g.__slotlyDb;
}
