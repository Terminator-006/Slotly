import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { ApiError, routeWithParams } from "@/lib/api";
import { requireAuth } from "@/lib/guard";
import { users } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = routeWithParams<{ id: string }>(async (req, { id }) => {
  const { db, business, user } = await requireAuth(req, ["owner"]);
  if (id === user.id) throw new ApiError(400, "cannot_remove_self", "You cannot remove your own account");

  const target = db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.businessId, business.id)))
    .get();
  if (!target) throw new ApiError(404, "not_found", "User not found");
  if (target.role === "owner") throw new ApiError(400, "cannot_remove_owner", "Owners cannot be removed");

  db.delete(users).where(eq(users.id, id)).run();
  return NextResponse.json({ ok: true });
});
