import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { ApiError, rateLimited, readQuery, routeWithParams } from "@/lib/api";
import { getFreeSlots } from "@/lib/bookings";
import { getDb } from "@/lib/db";
import { clientIp, limiters } from "@/lib/ratelimit";
import { businesses, services } from "@/lib/schema";
import { slotsQuerySchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/public/:slug/slots?serviceId=...&date=YYYY-MM-DD  (date is in the business timezone) */
export const GET = routeWithParams<{ slug: string }>(async (req, { slug }) => {
  const rl = limiters.slots.check(`slots:${clientIp(req.headers)}`);
  if (!rl.allowed) throw rateLimited(rl.retryAfterSec);

  const { serviceId, date } = readQuery(req, slotsQuerySchema);
  const db = await getDb();

  const [business] = await db.select().from(businesses).where(eq(businesses.slug, slug)).limit(1);
  if (!business) throw new ApiError(404, "not_found", "Business not found");
  const [service] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.businessId, business.id), eq(services.active, true)))
    .limit(1);
  if (!service) throw new ApiError(404, "service_not_found", "Service not found");

  const slots = (await getFreeSlots(db, business, service, date)).map((s) => ({
    start: new Date(s.startsAt).toISOString(),
    end: new Date(s.endsAt).toISOString(),
    local: s.local,
  }));
  return NextResponse.json({ date, timezone: business.timezone, slots });
});
