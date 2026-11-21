import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { ApiError, readJson, route } from "@/lib/api";
import { requireAuth } from "@/lib/guard";
import { businesses } from "@/lib/schema";
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

  if (patch.slug) {
    const clash = db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.slug, patch.slug), ne(businesses.id, business.id)))
      .get();
    if (clash) throw new ApiError(409, "slug_taken", "That booking URL is already taken");
  }

  db.update(businesses).set(patch).where(eq(businesses.id, business.id)).run();
  const updated = db.select().from(businesses).where(eq(businesses.id, business.id)).get()!;
  return NextResponse.json({ business: apiBusiness(updated) });
});
