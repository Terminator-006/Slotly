import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { insertRow, isDuplicateKeyError, NO_ID, type DB } from "./db";
import type { Booking, Business, Service } from "./schema";
import { dayBounds, generateSlots, localDate, type Slot } from "./slots";

export const BOOKING_RULES = {
  /** Customers cannot book a slot starting in less than this many minutes. */
  minNoticeMin: 30,
  /** How far ahead the public page lets people book. */
  maxDaysAhead: 60,
} as const;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A lock whose booking never materialised is treated as abandoned after this long. */
const ORPHAN_LOCK_GRACE_MS = 15_000;

async function windowsFor(db: DB, businessId: string) {
  return db.availability
    .find({ businessId }, { projection: { _id: 0, weekday: 1, startMin: 1, endMin: 1 } })
    .toArray();
}

async function busyOn(db: DB, businessId: string, date: string, timezone: string) {
  const bounds = dayBounds(date, timezone);
  if (!bounds) return [];
  return db.bookings
    .find(
      { businessId, status: "confirmed", startsAt: { $lt: bounds.end }, endsAt: { $gt: bounds.start } },
      { projection: { _id: 0, startsAt: 1, endsAt: 1 } },
    )
    .toArray();
}

/** Is `date` inside the bookable horizon (today .. today + maxDaysAhead) in the business timezone? */
export function isDateBookable(date: string, timezone: string, now: number): boolean {
  const today = localDate(now, timezone);
  const last = DateTime.fromMillis(now, { zone: timezone }).plus({ days: BOOKING_RULES.maxDaysAhead }).toISODate() ?? today;
  return date >= today && date <= last; // ISO dates compare correctly as strings
}

async function computeSlots(
  db: DB,
  business: Business,
  service: Service,
  date: string,
  now: number,
  opts: { ignoreBookings?: boolean } = {},
): Promise<Slot[]> {
  if (!isDateBookable(date, business.timezone, now)) return [];
  const [windows, busy] = await Promise.all([
    windowsFor(db, business.id),
    opts.ignoreBookings ? Promise.resolve([]) : busyOn(db, business.id, date, business.timezone),
  ]);
  return generateSlots({
    date,
    timezone: business.timezone,
    durationMin: service.durationMin,
    windows,
    busy,
    now,
    minNoticeMin: BOOKING_RULES.minNoticeMin,
  });
}

export function getFreeSlots(db: DB, business: Business, service: Service, date: string, now = Date.now()): Promise<Slot[]> {
  return computeSlots(db, business, service, date, now);
}

// ---------------------------------------------------------------------------------------
// Atomic slot claiming
//
// MongoDB has no exclusion constraints and we deliberately avoid multi-document transactions,
// so exclusivity comes from lock documents: one per minute of the appointment, with a
// deterministic `_id` of `${businessId}:${minuteIndex}`. `_id` uniqueness is enforced
// atomically by the server, so for any two overlapping bookings at least one insert fails.
// ---------------------------------------------------------------------------------------

function lockIds(businessId: string, startsAt: number, endsAt: number): string[] {
  const first = Math.floor(startsAt / MINUTE);
  const last = Math.ceil(endsAt / MINUTE) - 1; // half-open: [start, end)
  const ids: string[] = [];
  for (let m = first; m <= last; m++) ids.push(`${businessId}:${m}`);
  return ids;
}

async function releaseLocks(db: DB, bookingId: string): Promise<void> {
  await db.locks.deleteMany({ bookingId });
}

/**
 * Remove locks that block a claim but belong to nothing live: their booking was cancelled
 * (the process died between "mark cancelled" and "delete locks"), or their booking was never
 * written (the process died between "claim" and "insert booking") and the grace period passed.
 * Returns true if anything was cleared, i.e. a retry is worthwhile.
 */
async function clearStaleLocks(db: DB, ids: string[]): Promise<boolean> {
  const blocking = await db.locks.find({ _id: { $in: ids } }).toArray();
  if (blocking.length === 0) return true; // the blocker vanished in the meantime: retry

  const owners = await db.bookings
    .find({ _id: { $in: [...new Set(blocking.map((l) => l.bookingId))] } }, { projection: { _id: 1, status: 1 } })
    .toArray();
  const status = new Map(owners.map((o) => [o._id, o.status]));

  const nowMs = Date.now();
  const stale = blocking.filter((l) => {
    const s = status.get(l.bookingId);
    return s === "cancelled" || (s === undefined && nowMs - l.createdAt > ORPHAN_LOCK_GRACE_MS);
  });
  if (stale.length === 0) return false;
  await db.locks.deleteMany({ _id: { $in: stale.map((l) => l._id) } });
  return true;
}

/** Try to take every minute of [startsAt, endsAt). All-or-nothing; returns false if any is held. */
async function claimSlot(db: DB, bookingId: string, businessId: string, startsAt: number, endsAt: number): Promise<boolean> {
  const ids = lockIds(businessId, startsAt, endsAt);
  const createdAt = Date.now();
  const expireAt = new Date(endsAt + DAY);
  const docs = ids.map((_id) => ({ _id, businessId, bookingId, createdAt, expireAt }));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.locks.insertMany(docs, { ordered: false });
      return true;
    } catch (e) {
      await releaseLocks(db, bookingId); // undo the minutes we did get
      if (!isDuplicateKeyError(e)) throw e;
      if (attempt === 0 && (await clearStaleLocks(db, ids))) continue;
      return false;
    }
  }
  return false;
}

export type CreateBookingInput = {
  business: Business;
  service: Service;
  startsAt: number;
  customerName: string;
  customerEmail: string;
  now?: number;
};

export type CreateBookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "slot_taken" | "slot_unavailable" };

/**
 * Create a booking without ever double-booking.
 *
 * 1. Validate: the requested start must be a slot the engine would offer right now (inside
 *    opening hours, on the grid, past the minimum notice, not overlapping a confirmed booking).
 *    We re-derive this server-side and never trust the client's idea of what is free.
 * 2. Claim: atomically take every minute of the appointment (see above). Two requests that
 *    both passed step 1 for the same or overlapping times cannot both pass step 2.
 * 3. Write the booking. If that fails, give the minutes back.
 *
 * A partial unique index on (businessId, startsAt) where status = confirmed is a final safety
 * net for any code path that skips the claim.
 *
 * Postgres equivalent: an EXCLUDE USING gist constraint on tstzrange(starts_at, ends_at),
 * or SELECT ... FOR UPDATE on the business row inside a transaction.
 */
export async function createBooking(db: DB, input: CreateBookingInput): Promise<CreateBookingResult> {
  const { business, service } = input;
  const now = input.now ?? Date.now();

  const date = localDate(input.startsAt, business.timezone);
  const free = await computeSlots(db, business, service, date, now);
  if (!free.some((s) => s.startsAt === input.startsAt)) {
    // Distinguish "someone beat you to it" from "that was never a valid slot".
    const wouldBeValid = await computeSlots(db, business, service, date, now, { ignoreBookings: true });
    return {
      ok: false,
      reason: wouldBeValid.some((s) => s.startsAt === input.startsAt) ? "slot_taken" : "slot_unavailable",
    };
  }

  const bookingId = randomUUID();
  const endsAt = input.startsAt + service.durationMin * MINUTE;
  if (!(await claimSlot(db, bookingId, business.id, input.startsAt, endsAt))) {
    return { ok: false, reason: "slot_taken" };
  }

  const booking: Booking = {
    id: bookingId,
    businessId: business.id,
    serviceId: service.id,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    startsAt: input.startsAt,
    endsAt,
    status: "confirmed",
    createdAt: now,
  };
  try {
    await insertRow(db.bookings, booking);
  } catch (e) {
    await releaseLocks(db, bookingId);
    if (isDuplicateKeyError(e)) return { ok: false, reason: "slot_taken" };
    throw e;
  }
  return { ok: true, booking };
}

export type BookingWithService = Booking & { serviceName: string };

export async function listBookings(
  db: DB,
  businessId: string,
  scope: "upcoming" | "past" | "all",
  now = Date.now(),
): Promise<BookingWithService[]> {
  const filter =
    scope === "upcoming"
      ? { businessId, endsAt: { $gte: now } }
      : scope === "past"
        ? { businessId, endsAt: { $lt: now } }
        : { businessId };

  const rows = await db.bookings
    .find(filter, NO_ID)
    .sort({ startsAt: scope === "past" ? -1 : 1 })
    .limit(500)
    .toArray();

  const serviceIds = [...new Set(rows.map((r) => r.serviceId))];
  const names = new Map(
    (await db.services.find({ _id: { $in: serviceIds } }, { projection: { _id: 1, name: 1 } }).toArray()).map((s) => [s._id, s.name]),
  );
  return rows.map((r) => ({ ...r, serviceName: names.get(r.serviceId) ?? "(removed service)" }));
}

/** Cancel (idempotent). Returns null if the booking is not in this tenant. */
export async function cancelBooking(db: DB, businessId: string, bookingId: string): Promise<Booking | null> {
  const existing = await db.bookings.findOne({ _id: bookingId, businessId }, NO_ID);
  if (!existing) return null;

  if (existing.status === "confirmed") {
    // Order matters: mark cancelled first, then free the minutes. If we die in between, the
    // leftover locks belong to a cancelled booking and clearStaleLocks() reclaims them.
    // The reverse order could leave a confirmed booking with no locks.
    await db.bookings.updateOne({ _id: bookingId, businessId }, { $set: { status: "cancelled" } });
  }
  await releaseLocks(db, bookingId); // also heals leftovers when cancelling an already-cancelled booking
  return { ...existing, status: "cancelled" };
}
