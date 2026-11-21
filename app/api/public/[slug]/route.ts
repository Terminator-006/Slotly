import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { ApiError, routeWithParams } from "@/lib/api";
import { getDb } from "@/lib/db";
import { businesses, services } from "@/lib/schema";
import { apiBusiness, apiService } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: business profile + bookable services. Exposes no customer or user data. */
export const GET = routeWithParams<{ slug: string }>(async (_req, { slug }) => {
  const db = getDb();
  const business = db.select().from(businesses).where(eq(businesses.slug, slug)).get();
  if (!business) throw new ApiError(404, "not_found", "Business not found");
  const rows = db
    .select()
    .from(services)
    .where(and(eq(services.businessId, business.id), eq(services.active, true)))
    .orderBy(asc(services.createdAt))
    .all();
  return NextResponse.json({ business: apiBusiness(business), services: rows.map(apiService) });
});
