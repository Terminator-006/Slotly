import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "./db";
import { availability, businesses, services, users } from "./schema";

/**
 * Deterministic, UUID-shaped ids for demo rows. Seeding is therefore idempotent: running it
 * twice (or from two serverless instances at once) can only ever produce the same rows.
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

/**
 * Ensure the demo business exists and is complete. Returns true if this call created the
 * business. Safe to call repeatedly and concurrently (every insert is ON CONFLICT DO NOTHING).
 */
export async function seedDemo(db: DB): Promise<boolean> {
  const now = Date.now();
  const businessId = demoId("business");
  const passwordHash = await bcrypt.hash(DEMO.password, 10);

  return db.transaction(async (tx) => {
    const created = await tx
      .insert(businesses)
      .values({ id: businessId, name: "Fade & Co Barbers", slug: DEMO.slug, timezone: "Europe/Berlin", currency: "EUR", createdAt: now })
      .onConflictDoNothing()
      .returning({ id: businesses.id });

    await tx
      .insert(users)
      .values({ id: demoId("owner"), businessId, email: DEMO.email, passwordHash, role: "owner", createdAt: now })
      .onConflictDoNothing();

    const catalogue = [
      { name: "Classic haircut", durationMin: 30, priceCents: 2500 },
      { name: "Skin fade", durationMin: 45, priceCents: 3200 },
      { name: "Beard trim", durationMin: 20, priceCents: 1500 },
      { name: "Cut + beard combo", durationMin: 60, priceCents: 4200 },
    ];
    // createdAt is offset per row so the services keep their order when sorted by it.
    await tx
      .insert(services)
      .values(catalogue.map((s, i) => ({ id: demoId(`service:${s.name}`), businessId, ...s, active: true, createdAt: now + i })))
      .onConflictDoNothing();

    await tx
      .insert(availability)
      .values(defaultDemoWindows().map((w) => ({ id: demoId(`window:${w.weekday}:${w.startMin}`), businessId, ...w })))
      .onConflictDoNothing();

    return created.length > 0;
  });
}

/** Make sure the demo exists (one cheap indexed lookup per process once it does). */
export async function seedDemoIfMissing(db: DB): Promise<void> {
  const [exists] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, demoId("business"))).limit(1);
  if (!exists) await seedDemo(db);
}
