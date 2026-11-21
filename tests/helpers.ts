import { randomUUID } from "node:crypto";
import { afterAll, inject } from "vitest";
import { createDb, insertRow, insertRows, type DB } from "../lib/db";
import type { Business, Service } from "../lib/schema";

export const utc = (iso: string) => Date.parse(iso);

export const mongoUri = () => inject("mongoUri");

const opened: DB[] = [];

/** A brand-new, uniquely named database (indexes included). Dropped after the test file. */
export async function freshDb(name = `slotly_test_${randomUUID().replace(/-/g, "")}`): Promise<DB> {
  const db = await createDb(mongoUri(), name);
  opened.push(db);
  return db;
}

/** Another connection to an existing test database, like a second server instance. */
export async function connectAgain(db: DB): Promise<DB> {
  const again = await createDb(mongoUri(), db.db.databaseName);
  opened.push(again);
  return again;
}

/** Drop every database opened through freshDb and close all connections. Register once per file. */
export function cleanupDbsAfterAll() {
  afterAll(async () => {
    const dropped = new Set<string>();
    for (const db of opened) {
      const name = db.db.databaseName;
      if (!dropped.has(name)) {
        dropped.add(name);
        await db.db.dropDatabase().catch(() => {});
      }
      await db.client.close().catch(() => {});
    }
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
  await insertRow(db.businesses, business);

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
  await insertRows(db.services, [hour, half]);
  await insertRow(db.availability, { id: randomUUID(), businessId: business.id, weekday: 1, startMin: 540, endMin: 1020 });

  return { db, business, hour, half };
}

/** Monday 2026-01-05 09:00 Berlin: a week before the test dates. */
export const NOW = utc("2026-01-05T08:00:00Z");
