import { NextResponse } from "next/server";
import { ApiError, rateLimited, readJson, route } from "@/lib/api";
import { DUMMY_HASH, SESSION_COOKIE, sessionCookieOptions, signSession, verifyPassword } from "@/lib/auth";
import { getDb, NO_ID } from "@/lib/db";
import { clientIp, limiters } from "@/lib/ratelimit";
import { apiBusiness, apiUser } from "@/lib/serialize";
import { loginSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const rl = limiters.auth.check(`auth:${clientIp(req.headers)}`);
  if (!rl.allowed) throw rateLimited(rl.retryAfterSec);

  const { email, password } = await readJson(req, loginSchema);
  const db = await getDb();
  const user = await db.users.findOne({ email }, NO_ID);

  // Always run one bcrypt comparison, even for unknown emails, so timing doesn't reveal
  // which addresses have accounts. One generic message for both failure modes, too.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) throw new ApiError(401, "invalid_credentials", "Invalid email or password");

  const business = (await db.businesses.findOne({ _id: user.businessId }, NO_ID))!;
  const res = NextResponse.json({ user: apiUser(user), business: apiBusiness(business) });
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions());
  return res;
});
