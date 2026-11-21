import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { insertRows } from "@/lib/db";
import { readJson, route } from "@/lib/api";
import { requireAuth } from "@/lib/guard";
import { availabilitySchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { db, business } = await requireAuth(req);
  const rows = await db.availability
    .find({ businessId: business.id }, { projection: { _id: 0, weekday: 1, startMin: 1, endMin: 1 } })
    .sort({ weekday: 1, startMin: 1 })
    .toArray();
  return NextResponse.json({ windows: rows });
});

/**
 * Replace the whole weekly schedule. Insert the new rows first, then remove the old ones,
 * so a reader never sees an empty schedule halfway through (and a crash leaves old + new, not nothing).
 */
export const PUT = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const { windows } = await readJson(req, availabilitySchema);

  const fresh = windows.map((w) => ({ id: randomUUID(), businessId: business.id, ...w }));
  await insertRows(db.availability, fresh);
  await db.availability.deleteMany({ businessId: business.id, _id: { $nin: fresh.map((r) => r.id) } });
  return NextResponse.json({ windows });
});
