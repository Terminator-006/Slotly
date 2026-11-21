import { NextResponse } from "next/server";
import { ApiError, routeWithParams } from "@/lib/api";
import { getDb, NO_ID } from "@/lib/db";
import { apiBusiness, apiService } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: business profile + bookable services. Exposes no customer or user data. */
export const GET = routeWithParams<{ slug: string }>(async (_req, { slug }) => {
  const db = await getDb();
  const business = await db.businesses.findOne({ slug }, NO_ID);
  if (!business) throw new ApiError(404, "not_found", "Business not found");
  const rows = await db.services.find({ businessId: business.id, active: true }, NO_ID).sort({ createdAt: 1 }).toArray();
  return NextResponse.json({ business: apiBusiness(business), services: rows.map(apiService) });
});
