import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { insertRow, isDuplicateKeyError, type DB, type Doc } from "./db";
import type { Collection } from "mongodb";

/**
 * Deterministic, UUID-shaped ids for demo rows. Seeding is therefore idempotent: running it
 * twice (or from two serverless instances at once) can only ever produce the same documents.
 */
function demoId(name: string): string {
  const h = createHash("sha1").update(`slotly-demo:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const DEMO = {
  slug: "demo-barber",
  email: "demo@slotly.dev",
  password: "demo1234",
} as const;

/** Mon-Fri 09:00-12:30 + 13:30-18:00, Sat 10:00-14:00. */
export function defaultDemoWindows() {
  const rows: { weekday: number; startMin: number; endMin: number }[] = [];
  for (let weekday = 1; weekday <= 5; weekday++) {
    rows.push({ weekday, startMin: 9 * 60, endMin: 12 * 60 + 30 });
    rows.push({ weekday, startMin: 13 * 60 + 30, endMin: 18 * 60 });
  }
  rows.push({ weekday: 6, startMin: 10 * 60, endMin: 14 * 60 });
  return rows;
}

/** Insert unless a document with that id already exists. */
async function insertIfAbsent<T extends { id: string }>(col: Collection<Doc<T>>, row: T): Promise<boolean> {
  try {
    await insertRow(col, row);
    return true;
  } catch (e) {
    if (isDuplicateKeyError(e)) return false;
    throw e;
  }
}

/**
 * Ensure the demo business exists and is complete. Returns true if this call created the
 * business. Safe to call concurrently and repeatedly.
 */
export async function seedDemo(db: DB): Promise<boolean> {
  const now = Date.now();
  const businessId = demoId("business");

  // A real business already using the demo slug (different id) is left alone.
  const created = await insertIfAbsent(db.businesses, {
    id: businessId,
    name: "Fade & Co Barbers",
    slug: DEMO.slug,
    timezone: "Europe/Berlin",
    currency: "EUR",
    createdAt: now,
  });

  await insertIfAbsent(db.users, {
    id: demoId("owner"),
    businessId,
    email: DEMO.email,
    passwordHash: await bcrypt.hash(DEMO.password, 10),
    role: "owner",
    createdAt: now,
  });

  const catalogue = [
    { name: "Classic haircut", durationMin: 30, priceCents: 2500 },
    { name: "Skin fade", durationMin: 45, priceCents: 3200 },
    { name: "Beard trim", durationMin: 20, priceCents: 1500 },
    { name: "Cut + beard combo", durationMin: 60, priceCents: 4200 },
  ];
  // createdAt is offset per row so the services keep their order when sorted by it.
  for (const [i, s] of catalogue.entries()) {
    await insertIfAbsent(db.services, {
      id: demoId(`service:${s.name}`),
      businessId,
      ...s,
      active: true,
      createdAt: now + i,
    });
  }

  for (const w of defaultDemoWindows()) {
    await insertIfAbsent(db.availability, { id: demoId(`window:${w.weekday}:${w.startMin}`), businessId, ...w });
  }
  return created;
}

/** Make sure the demo exists (cheap check first, so normal requests pay one indexed lookup once per process). */
export async function seedDemoIfMissing(db: DB): Promise<void> {
  const exists = await db.businesses.findOne({ _id: demoId("business") }, { projection: { _id: 1 } });
  if (!exists) await seedDemo(db);
}
