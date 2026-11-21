import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "slotly_session";
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

const BCRYPT_COST = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Compared against when the email is unknown, so "no such user" and "wrong password"
// take about the same time (mitigates account enumeration by timing).
export const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set in production");
    }
    console.warn("[slotly] JWT_SECRET not set, using an insecure development default");
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-please");
  }
  return new TextEncoder().encode(value);
}

/**
 * The token only identifies the user (`sub`). Role and tenant are re-read from the
 * database on every request, so demoting or removing a user takes effect immediately
 * instead of living on inside a 7-day token.
 */
export async function signSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? { sub: payload.sub } : null;
  } catch {
    return null; // bad signature, expired, malformed
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true, // not readable from JS: limits the blast radius of XSS
    sameSite: "lax" as const, // blocks cross-site POSTs (CSRF); see also the Origin check in guard.ts
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  };
}
