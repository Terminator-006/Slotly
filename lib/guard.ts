import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ApiError } from "./api";
import { SESSION_COOKIE, verifySession } from "./auth";
import { getDb, type DB } from "./db";
import { businesses, users, type Business, type Role, type User } from "./schema";

export interface AuthContext {
  db: DB;
  user: User;
  business: Business;
}

async function resolve(token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  const claims = await verifySession(token);
  if (!claims) return null;

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user) return null; // deleted since the token was issued
  const [business] = await db.select().from(businesses).where(eq(businesses.id, user.businessId)).limit(1);
  return business ? { db, user, business } : null;
}

/**
 * CSRF defence in depth on top of SameSite=Lax: a browser always sends Origin on
 * cross-site POST/PATCH/PUT/DELETE, so a mismatch with our own Host is rejected.
 */
function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser client (curl, tests): no cookie-riding risk
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new ApiError(403, "bad_origin", "Cross-origin request rejected");
  }
  const own = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (own && host !== own) throw new ApiError(403, "bad_origin", "Cross-origin request rejected");
}

/**
 * Authenticate an API request and (optionally) enforce RBAC.
 * Roles: "owner" can change anything; "staff" can view and cancel bookings.
 */
export async function requireAuth(req: NextRequest, roles?: Role[]): Promise<AuthContext> {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
  const ctx = await resolve(req.cookies.get(SESSION_COOKIE)?.value);
  if (!ctx) throw new ApiError(401, "unauthenticated", "Please sign in");
  if (roles && !roles.includes(ctx.user.role)) {
    throw new ApiError(403, "forbidden", "Your role cannot do that");
  }
  return ctx;
}

/** For server components / layouts. Returns null when signed out. */
export async function getServerAuth(): Promise<AuthContext | null> {
  const jar = await cookies();
  return resolve(jar.get(SESSION_COOKIE)?.value);
}
