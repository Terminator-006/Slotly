import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ApiError, rateLimited, readJson, route } from "@/lib/api";
import { SESSION_COOKIE, hashPassword, sessionCookieOptions, signSession } from "@/lib/auth";
import { getDb, insertRow, insertRows, isDuplicateKeyError } from "@/lib/db";
import { clientIp, limiters } from "@/lib/ratelimit";
import type { AvailabilityRow, Business, User } from "@/lib/schema";
import { apiBusiness, apiUser } from "@/lib/serialize";
import { signupSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const rl = limiters.auth.check(`auth:${clientIp(req.headers)}`);
  if (!rl.allowed) throw rateLimited(rl.retryAfterSec);

  const input = await readJson(req, signupSchema);
  const db = await getDb();
  const passwordHash = await hashPassword(input.password);
  const now = Date.now();

  // Friendly pre-checks. They can race, so the unique indexes below are what actually decide.
  if (await db.users.findOne({ email: input.email }, { projection: { _id: 1 } })) {
    throw new ApiError(409, "email_taken", "An account with this email already exists");
  }
  if (await db.businesses.findOne({ slug: input.slug }, { projection: { _id: 1 } })) {
    throw new ApiError(409, "slug_taken", "That booking URL is already taken");
  }

  const business: Business = {
    id: randomUUID(),
    name: input.businessName,
    slug: input.slug,
    timezone: input.timezone,
    currency: input.currency,
    createdAt: now,
  };
  const user: User = { id: randomUUID(), businessId: business.id, email: input.email, passwordHash, role: "owner", createdAt: now };
  // Sensible starting hours so a new owner sees slots immediately: Mon-Fri 09:00-17:00.
  const windows: AvailabilityRow[] = [1, 2, 3, 4, 5].map((weekday) => ({
    id: randomUUID(),
    businessId: business.id,
    weekday,
    startMin: 540,
    endMin: 1020,
  }));

  // No multi-document transaction: insert in dependency order and undo by hand on failure.
  try {
    await insertRow(db.businesses, business);
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new ApiError(409, "slug_taken", "That booking URL is already taken");
    throw e;
  }
  try {
    await insertRow(db.users, user);
    await insertRows(db.availability, windows);
  } catch (e) {
    await Promise.allSettled([
      db.availability.deleteMany({ businessId: business.id }),
      db.users.deleteMany({ businessId: business.id }),
      db.businesses.deleteOne({ _id: business.id }),
    ]);
    if (isDuplicateKeyError(e)) throw new ApiError(409, "email_taken", "An account with this email already exists");
    throw e;
  }

  const res = NextResponse.json({ user: apiUser(user), business: apiBusiness(business) }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions());
  return res;
});
