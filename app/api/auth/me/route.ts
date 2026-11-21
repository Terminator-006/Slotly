import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAuth } from "@/lib/guard";
import { apiBusiness, apiUser } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { user, business } = await requireAuth(req);
  return NextResponse.json({ user: apiUser(user), business: apiBusiness(business) });
});
