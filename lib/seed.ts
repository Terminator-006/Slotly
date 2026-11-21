import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import type { DB } from "./db";
import { availability, businesses, services, users } from "./schema";

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

/** Creates the demo business. Returns false if the slug is already taken. */
export function seedDemo(db: DB): boolean {
  const now = Date.now();
  const businessId = randomUUID();

  return db.transaction((tx) => {
    const taken = tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, DEMO.slug)).get();
    if (taken) return false;

    tx.insert(businesses)
      .values({
        id: businessId,
        name: "Fade & Co Barbers",
        slug: DEMO.slug,
        timezone: "Europe/Berlin",
        currency: "EUR",
        createdAt: now,
      })
      .run();

    tx.insert(users)
      .values({
        id: randomUUID(),
        businessId,
        email: DEMO.email,
        passwordHash: bcrypt.hashSync(DEMO.password, 10),
        role: "owner",
        createdAt: now,
      })
      .run();

    const catalogue = [
      { name: "Classic haircut", durationMin: 30, priceCents: 2500 },
      { name: "Skin fade", durationMin: 45, priceCents: 3200 },
      { name: "Beard trim", durationMin: 20, priceCents: 1500 },
      { name: "Cut + beard combo", durationMin: 60, priceCents: 4200 },
    ];
    for (const s of catalogue) {
      tx.insert(services)
        .values({ id: randomUUID(), businessId, ...s, active: true, createdAt: now })
        .run();
    }

    for (const w of defaultDemoWindows()) {
      tx.insert(availability)
        .values({ id: randomUUID(), businessId, ...w })
        .run();
    }
    return true;
  });
}

export function seedDemoIfEmpty(db: DB): void {
  const [row] = db.select({ n: count() }).from(businesses).all();
  if (!row || row.n === 0) seedDemo(db);
}
