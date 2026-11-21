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
  if (!db.select({ id: services.id }).from(services).where(where).get()) {
    throw new ApiError(404, "not_found", "Service not found");
  }
  db.update(services).set(patch).where(where).run();
  return NextResponse.json({ service: apiService(db.select().from(services).where(where).get()!) });
});
