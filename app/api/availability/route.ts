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
  const rows = await db
    .select({ weekday: availability.weekday, startMin: availability.startMin, endMin: availability.endMin })
    .from(availability)
    .where(eq(availability.businessId, business.id))
    .orderBy(asc(availability.weekday), asc(availability.startMin));
  return NextResponse.json({ windows: rows });
});

/** Replace the whole weekly schedule atomically. */
export const PUT = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const { windows } = await readJson(req, availabilitySchema);

  await db.transaction(async (tx) => {
    await tx.delete(availability).where(eq(availability.businessId, business.id));
    if (windows.length > 0) {
      await tx.insert(availability).values(windows.map((w) => ({ id: randomUUID(), businessId: business.id, ...w })));
    }
  });
  return NextResponse.json({ windows });
});
