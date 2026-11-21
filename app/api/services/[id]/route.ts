import { NextResponse } from "next/server";
import { ApiError, readJson, routeWithParams } from "@/lib/api";
import { NO_ID } from "@/lib/db";
import { requireAuth } from "@/lib/guard";
import { apiService } from "@/lib/serialize";
import { servicePatchSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No DELETE on purpose: bookings reference services, so a service is archived (active: false).
export const PATCH = routeWithParams<{ id: string }>(async (req, { id }) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const patch = await readJson(req, servicePatchSchema);

  // The businessId in the filter is the tenant boundary: you can only touch your own rows.
  const where = { _id: id, businessId: business.id };
  if (!(await db.services.findOne(where, { projection: { _id: 1 } }))) {
    throw new ApiError(404, "not_found", "Service not found");
  }
  await db.services.updateOne(where, { $set: patch });
  return NextResponse.json({ service: apiService((await db.services.findOne(where, NO_ID))!) });
});
