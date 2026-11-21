import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cancelBooking, createBooking, getFreeSlots, listBookings } from "../lib/bookings";
import { and, eq } from "drizzle-orm";
import { isExclusionViolation } from "../lib/db";
import { bookings, type Booking } from "../lib/schema";
import { cleanupDbsAfterAll, NOW, setupBusiness, utc } from "./helpers";

cleanupDbsAfterAll();

const TEN = utc("2026-01-12T09:00:00Z"); // 10:00 Berlin on Monday 12 Jan
type Ctx = Awaited<ReturnType<typeof setupBusiness>>;

function book(ctx: Ctx, service: "hour" | "half", startsAt: number, name = "Ada") {
  return createBooking(ctx.db, {
    business: ctx.business,
    service: ctx[service],
    startsAt,
    customerName: name,
    customerEmail: `${name.toLowerCase()}@example.com`,
    now: NOW,
  });
}

const confirmed = (ctx: Ctx) =>
  ctx.db
    .select()
    .from(bookings)
    .where(and(eq(bookings.businessId, ctx.business.id), eq(bookings.status, "confirmed")));

describe("createBooking: happy path", () => {
  it("books a free slot and removes it from the free list", async () => {
    const ctx = await setupBusiness();
    const before = await getFreeSlots(ctx.db, ctx.business, ctx.hour, "2026-01-12", NOW);
    expect(before).toHaveLength(8); // 09:00-17:00, hourly

    const res = await book(ctx, "hour", TEN);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.booking.endsAt - res.booking.startsAt).toBe(60 * 60_000);
      expect(res.booking.status).toBe("confirmed");
    }

    const after = await getFreeSlots(ctx.db, ctx.business, ctx.hour, "2026-01-12", NOW);
    expect(after.map((s) => s.local)).not.toContain("10:00");
    expect(after).toHaveLength(7);
  });

});

describe("createBooking: double-booking protection", () => {
  it("rejects the same slot twice", async () => {
    const ctx = await setupBusiness();
    expect((await book(ctx, "hour", TEN, "Ada")).ok).toBe(true);
    expect(await book(ctx, "hour", TEN, "Grace")).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("rejects a booking that only partially overlaps an existing one", async () => {
    const ctx = await setupBusiness();
    expect((await book(ctx, "hour", TEN)).ok).toBe(true); // 10:00-11:00
    // 30-min service at 10:30 is a valid grid slot on its own, but collides with the hour booking.
    const res = await book(ctx, "half", utc("2026-01-12T09:30:00Z"), "Grace");
    expect(res).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("allows back-to-back bookings (end == start)", async () => {
    const ctx = await setupBusiness();
    expect((await book(ctx, "hour", TEN)).ok).toBe(true); // 10:00-11:00
    expect((await book(ctx, "half", utc("2026-01-12T10:00:00Z"), "Grace")).ok).toBe(true); // 11:00-11:30
    expect((await book(ctx, "half", utc("2026-01-12T08:30:00Z"), "Linus")).ok).toBe(true); // 09:30-10:00
  });

  it("frees the slot when a booking is cancelled", async () => {
    const ctx = await setupBusiness();
    const first = await book(ctx, "hour", TEN);
    if (!first.ok) throw new Error("setup failed");
    expect((await cancelBooking(ctx.db, ctx.business.id, first.booking.id))?.status).toBe("cancelled");
    expect((await book(ctx, "hour", TEN, "Grace")).ok).toBe(true);
  });

});

describe("createBooking: real concurrency", () => {
  it("lets exactly one of 12 simultaneous requests for the same slot win", async () => {
    const ctx = await setupBusiness();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => book(ctx, "hour", TEN, `User${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "slot_taken")).toHaveLength(11);
    expect(await confirmed(ctx)).toHaveLength(1);
  });

  it("never lets overlapping bookings of different lengths both succeed", async () => {
    const ctx = await setupBusiness();
    // 10:00-11:00 (hour) races 10:30-11:00 (half) and the two halves are individually valid grid slots.
    const attempts = [
      book(ctx, "hour", TEN, "A"),
      book(ctx, "half", utc("2026-01-12T09:30:00Z"), "B"), // 10:30-11:00
      book(ctx, "half", utc("2026-01-12T09:00:00Z"), "C"), // 10:00-10:30
    ];
    const results = await Promise.all(attempts);
    const winners = results.filter((r) => r.ok);
    // Either the hour wins alone, or the two halves win together; never an overlap.
    expect([1, 2]).toContain(winners.length);
    const sorted = [...(await confirmed(ctx))].sort((x, y) => x.startsAt - y.startsAt);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.startsAt).toBeGreaterThanOrEqual(sorted[i - 1]!.endsAt);
  });
});

describe("createBooking: the EXCLUDE constraint is the real guarantee", () => {
  const row = (ctx: Ctx, startsAt: number, endsAt: number, status: "confirmed" | "cancelled" = "confirmed"): Booking => ({
    id: randomUUID(),
    businessId: ctx.business.id,
    serviceId: ctx.hour.id,
    customerName: "X",
    customerEmail: "x@x.io",
    startsAt,
    endsAt,
    status,
    createdAt: 0,
  });
  const attempt = async (ctx: Ctx, b: Booking) => {
    try {
      await ctx.db.insert(bookings).values(b);
      return undefined;
    } catch (e) {
      return e;
    }
  };

  it("rejects an identical confirmed range even when the app-level check is bypassed", async () => {
    const ctx = await setupBusiness();
    expect(await attempt(ctx, row(ctx, TEN, TEN + 3_600_000))).toBeUndefined();
    expect(isExclusionViolation(await attempt(ctx, row(ctx, TEN, TEN + 3_600_000)))).toBe(true);
  });

  it("rejects a partial overlap (different start) too, which a plain unique index could not", async () => {
    const ctx = await setupBusiness();
    await attempt(ctx, row(ctx, TEN, TEN + 3_600_000)); // 10:00-11:00
    const err = await attempt(ctx, row(ctx, TEN + 30 * 60_000, TEN + 90 * 60_000)); // 10:30-11:30
    expect(isExclusionViolation(err)).toBe(true);
  });

  it("does not block a cancelled row, and back-to-back ranges are fine", async () => {
    const ctx = await setupBusiness();
    await attempt(ctx, row(ctx, TEN, TEN + 3_600_000, "cancelled"));
    expect(await attempt(ctx, row(ctx, TEN, TEN + 3_600_000))).toBeUndefined();
    expect(await attempt(ctx, row(ctx, TEN + 3_600_000, TEN + 7_200_000))).toBeUndefined(); // adjacent
    expect(await listBookings(ctx.db, ctx.business.id, "all", NOW)).toHaveLength(3);
  });

  it("scopes the constraint per business", async () => {
    const a = await setupBusiness();
    const b = await setupBusiness(a.db, "other-shop");
    expect(await attempt(a, row(a, TEN, TEN + 3_600_000))).toBeUndefined();
    expect(await attempt(b, row(b, TEN, TEN + 3_600_000))).toBeUndefined();
  });
});

describe("createBooking: invalid requests", () => {
  it.each([
    ["outside opening hours (03:00 local)", utc("2026-01-12T02:00:00Z")],
    ["on a closed day (Tuesday)", utc("2026-01-13T09:00:00Z")],
    ["off the slot grid (10:07)", utc("2026-01-12T09:07:00Z")],
    ["earlier today (already started)", utc("2026-01-05T08:00:00Z")], // 09:00 local, NOW is 09:00 local
    ["last week", utc("2025-12-29T09:00:00Z")],
    ["beyond the 60-day horizon", utc("2026-06-01T09:00:00Z")],
  ])("%s -> slot_unavailable", async (_label, startsAt) => {
    const ctx = await setupBusiness();
    expect(await book(ctx, "hour", startsAt)).toEqual({ ok: false, reason: "slot_unavailable" });
  });
});

describe("createBooking: minimum notice (30 min)", () => {
  // NOW is 09:00 Berlin on Monday 5 Jan. The 30-minute service has slots every 30 minutes.
  it("rejects a slot that starts before now + notice, accepts one exactly at the boundary", async () => {
    const ctx = await setupBusiness();
    expect(await book(ctx, "half", utc("2026-01-05T08:00:00Z"))).toEqual({ ok: false, reason: "slot_unavailable" }); // 09:00, started
    expect((await book(ctx, "half", utc("2026-01-05T08:30:00Z"))).ok).toBe(true); // 09:30 == now + 30 min
  });
});

describe("tenant isolation", () => {
  it("cannot cancel another business's booking", async () => {
    const a = await setupBusiness();
    const b = await setupBusiness(a.db, "other-shop");
    const made = await book(a, "hour", TEN);
    if (!made.ok) throw new Error("setup failed");

    expect(await cancelBooking(a.db, b.business.id, made.booking.id)).toBeNull();
    expect(await listBookings(a.db, b.business.id, "all", NOW)).toHaveLength(0);
    expect(await listBookings(a.db, a.business.id, "all", NOW)).toHaveLength(1);
  });

  it("two businesses can book the same instant independently", async () => {
    const a = await setupBusiness();
    const b = await setupBusiness(a.db, "other-shop");
    expect((await book(a, "hour", TEN)).ok).toBe(true);
    expect((await book(b, "hour", TEN)).ok).toBe(true);
  });

  it("cancelling twice is idempotent", async () => {
    const ctx = await setupBusiness();
    const made = await book(ctx, "hour", TEN);
    if (!made.ok) throw new Error("setup failed");
    await cancelBooking(ctx.db, ctx.business.id, made.booking.id);
    expect((await cancelBooking(ctx.db, ctx.business.id, made.booking.id))?.status).toBe("cancelled");
  });
});

describe("listBookings", () => {
  it("returns service names, upcoming ascending and past descending", async () => {
    const ctx = await setupBusiness();
    await book(ctx, "hour", TEN, "Ada");
    await book(ctx, "half", utc("2026-01-12T10:00:00Z"), "Grace");
    const upcoming = await listBookings(ctx.db, ctx.business.id, "upcoming", NOW);
    expect(upcoming.map((b) => b.serviceName)).toEqual(["Haircut", "Quick trim"]);
    expect(upcoming[0]!.startsAt).toBeLessThan(upcoming[1]!.startsAt);
    expect(await listBookings(ctx.db, ctx.business.id, "past", NOW)).toHaveLength(0);
  });
});
