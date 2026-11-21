import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ApiError, rateLimited, readJson, route } from "@/lib/api";
import { DUMMY_HASH, SESSION_COOKIE, sessionCookieOptions, signSession, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { clientIp, limiters } from "@/lib/ratelimit";
import { businesses, users } from "@/lib/schema";
import { apiBusiness, apiUser } from "@/lib/serialize";
import { loginSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const rl = limiters.auth.check(`auth:${clientIp(req.headers)}`);
  if (!rl.allowed) throw rateLimited(rl.retryAfterSec);

  const { email, password } = await readJson(req, loginSchema);
  const db = getDb();
  const user = db.select().from(users).where(eq(users.email, email)).get();

  // Always run one bcrypt comparison, even for unknown emails, so timing doesn't reveal
  // which addresses have accounts. One generic message for both failure modes, too.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) throw new ApiError(401, "invalid_credentials", "Invalid email or password");

  const business = db.select().from(businesses).where(eq(businesses.id, user.businessId)).get()!;
  const res = NextResponse.json({ user: apiUser(user), business: apiBusiness(business) });
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions());
  return res;
});
