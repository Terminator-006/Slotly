import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { hashPassword, signSession, verifyPassword, verifySession } from "../lib/auth";

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "test-secret-test-secret-test-secret-123");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("passwords", () => {
  it("hashes with bcrypt (salted) and verifies", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    expect(a).not.toBe(b); // per-hash salt
    expect(a.startsWith("$2")).toBe(true);
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
  });
});

describe("session JWT", () => {
  it("round-trips the user id", async () => {
    const token = await signSession("user-1");
    expect(await verifySession(token)).toEqual({ sub: "user-1" });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession("user-1");
    vi.stubEnv("JWT_SECRET", "another-secret-another-secret-another-1");
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = (await signSession("user-1")).split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url");
    expect(await verifySession(`${h}.${forged}.${s}`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await signSession("user-1");
    vi.setSystemTime(new Date("2026-01-09T00:00:00Z")); // 8 days later, TTL is 7
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects alg=none tokens", async () => {
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"user-1"}').toString("base64url")}.`;
    expect(await verifySession(none)).toBeNull();
  });

  it("rejects tokens without a subject", async () => {
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    expect(await verifySession(token)).toBeNull();
  });

  it("refuses to run in production without JWT_SECRET", async () => {
    vi.stubEnv("JWT_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(signSession("user-1")).rejects.toThrow(/JWT_SECRET/);
  });
});
