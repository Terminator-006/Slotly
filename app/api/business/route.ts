import { NextResponse } from "next/server";
import { ApiError, readJson, route } from "@/lib/api";
import { isDuplicateKeyError, NO_ID } from "@/lib/db";
import { requireAuth } from "@/lib/guard";
import { apiBusiness } from "@/lib/serialize";
import { businessPatchSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { business } = await requireAuth(req);
  return NextResponse.json({ business: apiBusiness(business) });
});

export const PATCH = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const patch = await readJson(req, businessPatchSchema);

  if (patch.slug && (await db.businesses.findOne({ slug: patch.slug, _id: { $ne: business.id } }, { projection: { _id: 1 } }))) {
    throw new ApiError(409, "slug_taken", "That booking URL is already taken");
  }

  try {
    await db.businesses.updateOne({ _id: business.id }, { $set: patch });
  } catch (e) {
    // Two owners claiming the same slug at once: the unique index decides.
    if (isDuplicateKeyError(e)) throw new ApiError(409, "slug_taken", "That booking URL is already taken");
    throw e;
  }
  const updated = (await db.businesses.findOne({ _id: business.id }, NO_ID))!;
  return NextResponse.json({ business: apiBusiness(updated) });
});
