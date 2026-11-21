import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cancelBooking, createBooking, getFreeSlots, listBookings } from "../lib/bookings";
import { createDb, isConstraintError } from "../lib/db";
import { bookings } from "../lib/schema";
import { NOW, setupBusiness, utc } from "./helpers";

const TEN = utc("2026-01-12T09:00:00Z"); // 10:00 Berlin on Monday 12 Jan

function book(ctx: ReturnType<typeof setupBusiness>, service: "hour" | "half", startsAt: number, name = "Ada") {
  return createBooking(ctx.db, {
    business: ctx.business,
    service: ctx[service],
    startsAt,
    customerName: name,
    customerEmail: `${name.toLowerCase()}@example.com`,
    now: NOW,
  });
}

describe("createBooking: happy path", () => {
  it("books a free slot and removes it from the free list", () => {
    const ctx = setupBusiness();
    const before = getFreeSlots(ctx.db, ctx.business, ctx.hour, "2026-01-12", NOW);
    expect(before).toHaveLength(8); // 09:00-17:00, hourly

    const res = book(ctx, "hour", TEN);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.booking.endsAt - res.booking.startsAt).toBe(60 * 60_000);
      expect(res.booking.status).toBe("confirmed");
    }

    const after = getFreeSlots(ctx.db, ctx.business, ctx.hour, "2026-01-12", NOW);
    expect(after.map((s) => s.local)).not.toContain("10:00");
    expect(after).toHaveLength(7);
  });
});

describe("createBooking: double-booking protection", () => {
  it("rejects the same slot twice", () => {
    const ctx = setupBusiness();
    expect(book(ctx, "hour", TEN, "Ada").ok).toBe(true);
    expect(book(ctx, "hour", TEN, "Grace")).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("rejects a booking that only partially overlaps an existing one", () => {
    const ctx = setupBusiness();
    expect(book(ctx, "hour", TEN).ok).toBe(true); // 10:00-11:00
    // 30-min service at 10:30 is a valid grid slot on its own, but collides with the hour booking.
    const res = book(ctx, "half", utc("2026-01-12T09:30:00Z"), "Grace");
    expect(res).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("allows back-to-back bookings (end == start)", () => {
    const ctx = setupBusiness();
    expect(book(ctx, "hour", TEN).ok).toBe(true); // 10:00-11:00
    expect(book(ctx, "half", utc("2026-01-12T10:00:00Z"), "Grace").ok).toBe(true); // 11:00-11:30
    expect(book(ctx, "half", utc("2026-01-12T08:30:00Z"), "Linus").ok).toBe(true); // 09:30-10:00
  });

  it("frees the slot when a booking is cancelled", () => {
    const ctx = setupBusiness();
    const first = book(ctx, "hour", TEN);
    if (!first.ok) throw new Error("setup failed");
    expect(cancelBooking(ctx.db, ctx.business.id, first.booking.id)?.status).toBe("cancelled");
    expect(book(ctx, "hour", TEN, "Grace").ok).toBe(true);
  });

  it("works across separate connections to the same database file", () => {
    // Two server instances sharing one file: the second must see the first one's write.
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slotly-")), "t.db");
    try {
      const a = setupBusiness(createDb(file));
      const dbB = createDb(file);
      const first = createBooking(a.db, { business: a.business, service: a.hour, startsAt: TEN, customerName: "A", customerEmail: "a@x.io", now: NOW });
      const second = createBooking(dbB, { business: a.business, service: a.hour, startsAt: TEN, customerName: "B", customerEmail: "b@x.io", now: NOW });
      expect(first.ok).toBe(true);
      expect(second).toEqual({ ok: false, reason: "slot_taken" });
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

describe("createBooking: the unique index is a real safety net", () => {
  const row = (businessId: string, serviceId: string, status: "confirmed" | "cancelled") => ({
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

  it("blocks two confirmed rows with the same start even if the app-level check is bypassed", () => {
    const { db, business, hour } = setupBusiness();
    db.insert(bookings).values(row(business.id, hour.id, "confirmed")).run();
    let error: unknown;
    try {
      db.insert(bookings).values(row(business.id, hour.id, "confirmed")).run();
    } catch (e) {
      error = e;
    }
    expect(isConstraintError(error)).toBe(true);
  });

  it("does not block a cancelled row sharing the start time", () => {
    const { db, business, hour } = setupBusiness();
    db.insert(bookings).values(row(business.id, hour.id, "cancelled")).run();
    db.insert(bookings).values(row(business.id, hour.id, "confirmed")).run();
    expect(listBookings(db, business.id, "all", NOW)).toHaveLength(2);
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
  ])("%s -> slot_unavailable", (_label, startsAt) => {
    const ctx = setupBusiness();
    expect(book(ctx, "hour", startsAt)).toEqual({ ok: false, reason: "slot_unavailable" });
  });
});

describe("createBooking: minimum notice (30 min)", () => {
  // NOW is 09:00 Berlin on Monday 5 Jan. The 30-minute service has slots every 30 minutes.
  it("rejects a slot that starts before now + notice, accepts one exactly at the boundary", () => {
    const ctx = setupBusiness();
    expect(book(ctx, "half", utc("2026-01-05T08:00:00Z"))).toEqual({ ok: false, reason: "slot_unavailable" }); // 09:00, started
    expect(book(ctx, "half", utc("2026-01-05T08:30:00Z")).ok).toBe(true); // 09:30 == now + 30 min
  });
});

describe("tenant isolation", () => {
  it("cannot cancel another business's booking", () => {
    const a = setupBusiness();
    const b = setupBusiness(a.db, "other-shop");
    const made = book(a, "hour", TEN);
    if (!made.ok) throw new Error("setup failed");

    expect(cancelBooking(a.db, b.business.id, made.booking.id)).toBeNull();
    expect(listBookings(a.db, b.business.id, "all", NOW)).toHaveLength(0);
    expect(listBookings(a.db, a.business.id, "all", NOW)).toHaveLength(1);
  });

  it("cancelling twice is idempotent", () => {
    const ctx = setupBusiness();
    const made = book(ctx, "hour", TEN);
    if (!made.ok) throw new Error("setup failed");
    cancelBooking(ctx.db, ctx.business.id, made.booking.id);
    expect(cancelBooking(ctx.db, ctx.business.id, made.booking.id)?.status).toBe("cancelled");
  });
});
