import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { ApiError, readJson, route } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { isConstraintError } from "@/lib/db";
import { requireAuth } from "@/lib/guard";
import { users } from "@/lib/schema";
import { apiUser } from "@/lib/serialize";
import { staffCreateSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const rows = db.select().from(users).where(eq(users.businessId, business.id)).orderBy(asc(users.createdAt)).all();
  return NextResponse.json({ users: rows.map(apiUser) });
});

/** Owner creates a staff login (can see and cancel bookings, nothing else). */
export const POST = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const input = await readJson(req, staffCreateSchema);

  const row = {
    id: randomUUID(),
    businessId: business.id,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: "staff" as const,
    createdAt: Date.now(),
  };
  try {
    db.insert(users).values(row).run();
  } catch (e) {
    if (isConstraintError(e)) throw new ApiError(409, "email_taken", "An account with this email already exists");
    throw e;
  }
  return NextResponse.json({ user: apiUser(row) }, { status: 201 });
});
