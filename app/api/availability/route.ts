import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readJson, route } from "@/lib/api";
import { requireAuth } from "@/lib/guard";
import { availability } from "@/lib/schema";
import { availabilitySchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { db, business } = await requireAuth(req);
  const rows = db
    .select({ weekday: availability.weekday, startMin: availability.startMin, endMin: availability.endMin })
    .from(availability)
    .where(eq(availability.businessId, business.id))
    .orderBy(asc(availability.weekday), asc(availability.startMin))
    .all();
  return NextResponse.json({ windows: rows });
});

/** Replace the whole weekly schedule atomically. */
export const PUT = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const { windows } = await readJson(req, availabilitySchema);

  db.transaction((tx) => {
    tx.delete(availability).where(eq(availability.businessId, business.id)).run();
    for (const w of windows) {
      tx.insert(availability).values({ id: randomUUID(), businessId: business.id, ...w }).run();
    }
  });
  return NextResponse.json({ windows });
});
