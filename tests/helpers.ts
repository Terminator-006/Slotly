import { randomUUID } from "node:crypto";
import { afterAll } from "vitest";
import { closeDb, createPgliteDb, type DB } from "../lib/db";
import { availability, businesses, services, type Business, type Service } from "../lib/schema";

export const utc = (iso: string) => Date.parse(iso);

const opened: DB[] = [];

/** A brand-new in-memory Postgres (PGlite) with the real schema and constraints applied. */
export async function freshDb(): Promise<DB> {
  const db = await createPgliteDb();
  opened.push(db);
  return db;
}

/** Close every database opened through freshDb. Register once per test file. */
export function cleanupDbsAfterAll() {
  afterAll(async () => {
    await Promise.all(opened.map((db) => closeDb(db).catch(() => {})));
    opened.length = 0;
  });
}

/**
 * A business in Berlin open Monday 09:00-17:00 with a 60-minute and a 30-minute service.
 * 2026-01-12 is a Monday; Berlin is UTC+1 then, so 10:00 local = 09:00Z.
 */
export async function setupBusiness(dbOrUndefined?: DB, slug = "test-shop") {
  const db = dbOrUndefined ?? (await freshDb());
  const business: Business = {
    id: randomUUID(),
    name: "Test Shop",
    slug,
    timezone: "Europe/Berlin",
    currency: "EUR",
    createdAt: 0,
  };
  await db.insert(businesses).values(business);

  const mk = (name: string, durationMin: number): Service => ({
    id: randomUUID(),
    businessId: business.id,
    name,
    durationMin,
    priceCents: 2000,
    active: true,
    createdAt: 0,
  });
  const hour = mk("Haircut", 60);
  const half = mk("Quick trim", 30);
  await db.insert(services).values([hour, half]);
  await db.insert(availability).values({ id: randomUUID(), businessId: business.id, weekday: 1, startMin: 540, endMin: 1020 });

  return { db, business, hour, half };
}

/** Monday 2026-01-05 09:00 Berlin: a week before the test dates. */
export const NOW = utc("2026-01-05T08:00:00Z");
