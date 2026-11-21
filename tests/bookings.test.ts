import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cancelBooking, createBooking, getFreeSlots, listBookings } from "../lib/bookings";
import { insertRow, isDuplicateKeyError } from "../lib/db";
import type { Booking } from "../lib/schema";
import { cleanupDbsAfterAll, connectAgain, NOW, setupBusiness, utc } from "./helpers";

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

const lockCount = (ctx: Ctx) => ctx.db.locks.countDocuments({ businessId: ctx.business.id });

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

  it("holds one lock per minute of the appointment", async () => {
    const ctx = await setupBusiness();
    await book(ctx, "hour", TEN);
    expect(await lockCount(ctx)).toBe(60);
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
    expect(await lockCount(ctx)).toBe(0);
    expect((await book(ctx, "hour", TEN, "Grace")).ok).toBe(true);
  });

  it("works across separate connections to the same database", async () => {
    // Two server instances sharing one database: the second must see the first one's write.
    const a = await setupBusiness();
    const dbB = await connectAgain(a.db);
    const first = await createBooking(a.db, { business: a.business, service: a.hour, startsAt: TEN, customerName: "A", customerEmail: "a@x.io", now: NOW });
    const second = await createBooking(dbB, { business: a.business, service: a.hour, startsAt: TEN, customerName: "B", customerEmail: "b@x.io", now: NOW });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "slot_taken" });
  });
});

describe("createBooking: real concurrency", () => {
  it("lets exactly one of 12 simultaneous requests for the same slot win", async () => {
    const ctx = await setupBusiness();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => book(ctx, "hour", TEN, `User${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "slot_taken")).toHaveLength(11);
    expect(await ctx.db.bookings.countDocuments({ businessId: ctx.business.id, status: "confirmed" })).toBe(1);
    expect(await lockCount(ctx)).toBe(60); // losers gave everything back
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
    const confirmed = await ctx.db.bookings.find({ businessId: ctx.business.id, status: "confirmed" }).toArray();
    const sorted = [...confirmed].sort((x, y) => x.startsAt - y.startsAt);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.startsAt).toBeGreaterThanOrEqual(sorted[i - 1]!.endsAt);
  });
});

describe("createBooking: stale locks do not wedge a slot", () => {
  const lockDoc = (businessId: string, bookingId: string, createdAt: number) => {
    const first = Math.floor(TEN / 60_000);
    return Array.from({ length: 60 }, (_, i) => ({
      _id: `${businessId}:${first + i}`,
      businessId,
      bookingId,
      createdAt,
      expireAt: new Date(TEN + 86_400_000),
    }));
  };

  it("reclaims locks left behind by a cancelled booking", async () => {
    const ctx = await setupBusiness();
    const ghostId = randomUUID();
    const ghost: Booking = {
      id: ghostId,
      businessId: ctx.business.id,
      serviceId: ctx.hour.id,
      customerName: "Ghost",
      customerEmail: "g@x.io",
      startsAt: TEN,
      endsAt: TEN + 3_600_000,
      status: "cancelled",
      createdAt: 0,
    };
    await insertRow(ctx.db.bookings, ghost);
    await ctx.db.locks.insertMany(lockDoc(ctx.business.id, ghostId, Date.now()));
    expect((await book(ctx, "hour", TEN)).ok).toBe(true);
  });

  it("reclaims orphan locks (no booking was ever written) once the grace period has passed", async () => {
    const ctx = await setupBusiness();
    await ctx.db.locks.insertMany(lockDoc(ctx.business.id, randomUUID(), Date.now() - 60_000));
    expect((await book(ctx, "hour", TEN)).ok).toBe(true);
  });

  it("still honours a fresh in-flight claim", async () => {
    const ctx = await setupBusiness();
    await ctx.db.locks.insertMany(lockDoc(ctx.business.id, randomUUID(), Date.now()));
    expect(await book(ctx, "hour", TEN)).toEqual({ ok: false, reason: "slot_taken" });
    expect(await lockCount(ctx)).toBe(60); // the other claim's locks are untouched
  });
});

describe("createBooking: the unique index is a real safety net", () => {
  const row = (businessId: string, serviceId: string, status: "confirmed" | "cancelled"): Booking => ({
    id: randomUUID(),
    businessId,
    serviceId,
    customerName: "X",
    customerEmail: "x@x.io",
    startsAt: TEN,
    endsAt: TEN + 3_600_000,
    status,
    createdAt: 0,
  });

  it("blocks two confirmed rows with the same start even if the lock layer is bypassed", async () => {
    const { db, business, hour } = await setupBusiness();
    await insertRow(db.bookings, row(business.id, hour.id, "confirmed"));
    let error: unknown;
    try {
      await insertRow(db.bookings, row(business.id, hour.id, "confirmed"));
    } catch (e) {
      error = e;
    }
    expect(isDuplicateKeyError(error)).toBe(true);
  });

  it("does not block a cancelled row sharing the start time", async () => {
    const { db, business, hour } = await setupBusiness();
    await insertRow(db.bookings, row(business.id, hour.id, "cancelled"));
    await insertRow(db.bookings, row(business.id, hour.id, "confirmed"));
    expect(await listBookings(db, business.id, "all", NOW)).toHaveLength(2);
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
    expect(await lockCount(ctx)).toBe(0);
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
    expect(await lockCount(a)).toBe(60); // the failed cross-tenant cancel freed nothing
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
