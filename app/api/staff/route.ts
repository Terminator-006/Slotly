import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ApiError, readJson, route } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { insertRow, isDuplicateKeyError, NO_ID } from "@/lib/db";
import { requireAuth } from "@/lib/guard";
import type { User } from "@/lib/schema";
import { apiUser } from "@/lib/serialize";
import { staffCreateSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const rows = await db.users.find({ businessId: business.id }, NO_ID).sort({ createdAt: 1 }).toArray();
  return NextResponse.json({ users: rows.map(apiUser) });
});

/** Owner creates a staff login (can see and cancel bookings, nothing else). */
export const POST = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const input = await readJson(req, staffCreateSchema);

  const row: User = {
    id: randomUUID(),
    businessId: business.id,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: "staff",
    createdAt: Date.now(),
  };
  try {
    await insertRow(db.users, row);
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new ApiError(409, "email_taken", "An account with this email already exists");
    throw e;
  }
  return NextResponse.json({ user: apiUser(row) }, { status: 201 });
});
