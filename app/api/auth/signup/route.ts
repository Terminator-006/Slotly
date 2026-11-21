import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { ApiError, rateLimited, readJson, route } from "@/lib/api";
import { SESSION_COOKIE, hashPassword, sessionCookieOptions, signSession } from "@/lib/auth";
import { getDb, isConstraintError } from "@/lib/db";
import { clientIp, limiters } from "@/lib/ratelimit";
import { availability, businesses, users } from "@/lib/schema";
import { apiBusiness, apiUser } from "@/lib/serialize";
import { signupSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const rl = limiters.auth.check(`auth:${clientIp(req.headers)}`);
  if (!rl.allowed) throw rateLimited(rl.retryAfterSec);

  const input = await readJson(req, signupSchema);
  const db = getDb();
  const passwordHash = await hashPassword(input.password);
  const now = Date.now();
  const businessId = randomUUID();
  const userId = randomUUID();

  try {
    db.transaction((tx) => {
      if (tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get()) {
        throw new ApiError(409, "email_taken", "An account with this email already exists");
      }
      if (tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, input.slug)).get()) {
        throw new ApiError(409, "slug_taken", "That booking URL is already taken");
      }
      tx.insert(businesses)
        .values({
          id: businessId,
          name: input.businessName,
          slug: input.slug,
          timezone: input.timezone,
          currency: input.currency,
          createdAt: now,
        })
        .run();
      tx.insert(users).values({ id: userId, businessId, email: input.email, passwordHash, role: "owner", createdAt: now }).run();
      // Sensible starting hours so a new owner sees slots immediately: Mon-Fri 09:00-17:00.
      for (let weekday = 1; weekday <= 5; weekday++) {
        tx.insert(availability).values({ id: randomUUID(), businessId, weekday, startMin: 540, endMin: 1020 }).run();
      }
    });
  } catch (e) {
    // Two simultaneous signups can both pass the checks above; the UNIQUE constraints decide.
    if (isConstraintError(e)) throw new ApiError(409, "conflict", "Email or booking URL already in use");
    throw e;
  }

  const business = db.select().from(businesses).where(eq(businesses.id, businessId)).get()!;
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;

  const res = NextResponse.json({ user: apiUser(user), business: apiBusiness(business) }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, await signSession(userId), sessionCookieOptions());
  return res;
});
