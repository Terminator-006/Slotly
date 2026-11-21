import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { ApiError, readJson, routeWithParams } from "@/lib/api";
import { requireAuth } from "@/lib/guard";
import { services } from "@/lib/schema";
import { apiService } from "@/lib/serialize";
import { servicePatchSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No DELETE on purpose: bookings reference services, so a service is archived (active: false).
export const PATCH = routeWithParams<{ id: string }>(async (req, { id }) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const patch = await readJson(req, servicePatchSchema);

  // The businessId in the WHERE clause is the tenant boundary: you can only touch your own rows.
  const where = and(eq(services.id, id), eq(services.businessId, business.id));
  const [existing] = await db.select({ id: services.id }).from(services).where(where).limit(1);
  if (!existing) throw new ApiError(404, "not_found", "Service not found");

  // An empty patch would be invalid SQL for UPDATE ... SET; nothing to change then.
  if (Object.keys(patch).length > 0) await db.update(services).set(patch).where(where);
  const [updated] = await db.select().from(services).where(where).limit(1);
  return NextResponse.json({ service: apiService(updated!) });
});
