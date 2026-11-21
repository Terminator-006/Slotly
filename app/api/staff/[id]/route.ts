import { NextResponse } from "next/server";
import { ApiError, routeWithParams } from "@/lib/api";
import { NO_ID } from "@/lib/db";
import { requireAuth } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = routeWithParams<{ id: string }>(async (req, { id }) => {
  const { db, business, user } = await requireAuth(req, ["owner"]);
  if (id === user.id) throw new ApiError(400, "cannot_remove_self", "You cannot remove your own account");

  const target = await db.users.findOne({ _id: id, businessId: business.id }, NO_ID);
  if (!target) throw new ApiError(404, "not_found", "User not found");
  if (target.role === "owner") throw new ApiError(400, "cannot_remove_owner", "Owners cannot be removed");

  await db.users.deleteOne({ _id: id, businessId: business.id });
  return NextResponse.json({ ok: true });
});
