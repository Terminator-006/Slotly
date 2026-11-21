import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DateTime } from "luxon";

/**
 * End-to-end through the real route handlers (no HTTP server): signup -> configure ->
 * public booking -> double booking -> RBAC -> tenant isolation -> rate limiting.
 */

process.env.JWT_SECRET = "api-test-secret-api-test-secret-123456";

type Handler = (req: NextRequest, ctx: any) => Promise<Response>;
type Module = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>>;

const routes: Record<string, Module> = {};

beforeAll(async () => {
  // Point the app at the test MongoDB, in a database of its own.
  process.env.MONGODB_URI = inject("mongoUri");
  process.env.MONGODB_DB = `slotly_api_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  vi.spyOn(console, "log").mockImplementation(() => {}); // silence ConsoleMailer
  routes.signup = await import("../app/api/auth/signup/route");
  routes.login = await import("../app/api/auth/login/route");
  routes.me = await import("../app/api/auth/me/route");
  routes.services = await import("../app/api/services/route");
  routes.availability = await import("../app/api/availability/route");
  routes.bookings = await import("../app/api/bookings/route");
  routes.cancel = await import("../app/api/bookings/[id]/cancel/route");
  routes.staff = await import("../app/api/staff/route");
  routes.pubSlots = await import("../app/api/public/[slug]/slots/route");
  routes.pubBook = await import("../app/api/public/[slug]/bookings/route");
  routes.pubInfo = await import("../app/api/public/[slug]/route");
});

afterAll(async () => {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  await db.db.dropDatabase();
  await db.client.close();
});

function call(
  mod: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  opts: { body?: unknown; cookie?: string; params?: Record<string, string>; query?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = new NextRequest(`http://localhost:3000/api/x${opts.query ?? ""}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return routes[mod]![method]!(req, { params: Promise.resolve(opts.params ?? {}) });
}

const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

describe("Slotly API", () => {
  const tz = "Europe/Berlin";
  // 3 days out in the business timezone: always inside the booking horizon.
  const date = DateTime.now().setZone(tz).plus({ days: 3 }).toISODate()!;
  let owner = "";
  let serviceId = "";
  let firstSlot = "";
  let bookingId = "";

  it("rejects unauthenticated access", async () => {
    expect((await call("services", "GET")).status).toBe(401);
    expect((await call("me", "GET", { cookie: "slotly_session=garbage" })).status).toBe(401);
  });

  it("signs up an owner and sets an httpOnly session cookie", async () => {
    const res = await call("signup", "POST", {
      body: { email: "owner@a.test", password: "password123", businessName: "Shop A", slug: "shop-a", timezone: tz, currency: "EUR" },
    });
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    owner = cookieOf(res);

    const me = await (await call("me", "GET", { cookie: owner })).json();
    expect(me.user.role).toBe("owner");
    expect(me.business.slug).toBe("shop-a");
    expect(JSON.stringify(me)).not.toContain("password");
  });

  it("validates input with structured 422 errors", async () => {
    const res = await call("signup", "POST", { body: { email: "nope", password: "x", businessName: "", slug: "A B", timezone: "Mars/X" } });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("validation_error");
    expect(json.error.details.length).toBeGreaterThanOrEqual(4);
  });

  it("returns 409 for a duplicate email or slug", async () => {
    const dup = await call("signup", "POST", {
      body: { email: "owner@a.test", password: "password123", businessName: "Other", slug: "other", timezone: tz },
    });
    expect(dup.status).toBe(409);
  });

  it("lets the owner create a service and open every day 09:00-17:00", async () => {
    const created = await call("services", "POST", { cookie: owner, body: { name: "Haircut", durationMin: 60, priceCents: 2500 } });
    expect(created.status).toBe(201);
    serviceId = (await created.json()).service.id;

    const windows = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMin: 540, endMin: 1020 }));
    expect((await call("availability", "PUT", { cookie: owner, body: { windows } })).status).toBe(200);
  });

  it("serves public slots for the chosen day", async () => {
    const res = await call("pubSlots", "GET", { params: { slug: "shop-a" }, query: `?serviceId=${serviceId}&date=${date}` });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.timezone).toBe(tz);
    expect(json.slots.map((s: { local: string }) => s.local)).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    firstSlot = json.slots[0].start;
  });

  it("public business info never leaks users or bookings", async () => {
    const json = await (await call("pubInfo", "GET", { params: { slug: "shop-a" } })).json();
    expect(Object.keys(json).sort()).toEqual(["business", "services"]);
    expect(JSON.stringify(json)).not.toContain("owner@a.test");
  });

  it("books a slot, then refuses a second booking of the same slot with 409", async () => {
    const body = { serviceId, start: firstSlot, name: "Ada", email: "ada@x.test" };
    const first = await call("pubBook", "POST", { params: { slug: "shop-a" }, body });
    expect(first.status).toBe(201);
    bookingId = (await first.json()).booking.id;

    const second = await call("pubBook", "POST", { params: { slug: "shop-a" }, body: { ...body, name: "Grace", email: "grace@x.test" } });
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("slot_taken");

    const slots = await (await call("pubSlots", "GET", { params: { slug: "shop-a" }, query: `?serviceId=${serviceId}&date=${date}` })).json();
    expect(slots.slots.map((s: { start: string }) => s.start)).not.toContain(firstSlot);
  });

  it("rejects a slot that was never offered with 422", async () => {
    const odd = DateTime.fromISO(firstSlot).plus({ minutes: 7 }).toUTC().toISO()!;
    const res = await call("pubBook", "POST", { params: { slug: "shop-a" }, body: { serviceId, start: odd, name: "Ada", email: "ada@x.test" } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("slot_unavailable");
  });

  it("shows the booking to the owner", async () => {
    const json = await (await call("bookings", "GET", { cookie: owner })).json();
    expect(json.bookings).toHaveLength(1);
    expect(json.bookings[0]).toMatchObject({ id: bookingId, customerName: "Ada", serviceName: "Haircut", status: "confirmed" });
  });

  describe("RBAC", () => {
    let staff = "";

    it("owner creates a staff login", async () => {
      const res = await call("staff", "POST", { cookie: owner, body: { email: "staff@a.test", password: "password123" } });
      expect(res.status).toBe(201);
      const login = await call("login", "POST", { body: { email: "staff@a.test", password: "password123" } });
      expect(login.status).toBe(200);
      staff = cookieOf(login);
    });

    it("staff can read bookings but cannot change configuration or manage staff", async () => {
      expect((await call("bookings", "GET", { cookie: staff })).status).toBe(200);
      expect((await call("services", "POST", { cookie: staff, body: { name: "X", durationMin: 30, priceCents: 0 } })).status).toBe(403);
      expect((await call("availability", "PUT", { cookie: staff, body: { windows: [] } })).status).toBe(403);
      expect((await call("staff", "GET", { cookie: staff })).status).toBe(403);
    });

    it("staff can cancel a booking, and cancelling again is harmless", async () => {
      const res = await call("cancel", "POST", { cookie: staff, params: { id: bookingId } });
      expect(res.status).toBe(200);
      expect((await res.json()).booking.status).toBe("cancelled");
      expect((await call("cancel", "POST", { cookie: staff, params: { id: bookingId } })).status).toBe(200);
    });

    it("the cancelled slot is bookable again", async () => {
      const res = await call("pubBook", "POST", {
        params: { slug: "shop-a" },
        body: { serviceId, start: firstSlot, name: "Grace", email: "grace@x.test" },
      });
      expect(res.status).toBe(201);
    });
  });

  describe("tenant isolation", () => {
    it("another business cannot see or cancel shop-a's bookings", async () => {
      const signup = await call("signup", "POST", {
        body: { email: "owner@b.test", password: "password123", businessName: "Shop B", slug: "shop-b", timezone: tz },
      });
      const other = cookieOf(signup);
      expect((await (await call("bookings", "GET", { cookie: other })).json()).bookings).toHaveLength(0);
      expect((await call("cancel", "POST", { cookie: other, params: { id: bookingId } })).status).toBe(404);
      // Shop B cannot book Shop A's service through its own slug either.
      const res = await call("pubBook", "POST", {
        params: { slug: "shop-b" },
        body: { serviceId, start: firstSlot, name: "Eve", email: "eve@x.test" },
      });
      expect(res.status).toBe(404);
    });
  });

  it("blocks cross-origin state changes (CSRF defence in depth)", async () => {
    const res = await call("services", "POST", {
      cookie: owner,
      headers: { origin: "https://evil.example", host: "localhost:3000" },
      body: { name: "Pwn", durationMin: 30, priceCents: 0 },
    });
    expect(res.status).toBe(403);
  });

  it("rate-limits the booking endpoint and sets Retry-After", async () => {
    let limited: Response | undefined;
    for (let i = 0; i < 15 && !limited; i++) {
      const res = await call("pubBook", "POST", { params: { slug: "shop-a" }, body: { nope: true } });
      if (res.status === 429) limited = res;
    }
    expect(limited).toBeDefined();
    expect(Number(limited!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
