import { and, asc, desc, eq, gt, gte, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { isExclusionViolation, isUniqueViolation, type DB } from "./db";
import { availability, bookings, services, type Booking, type Business, type Service } from "./schema";
import { dayBounds, generateSlots, localDate, type Slot } from "./slots";

export const BOOKING_RULES = {
  /** Customers cannot book a slot starting in less than this many minutes. */
  minNoticeMin: 30,
  /** How far ahead the public page lets people book. */
  maxDaysAhead: 60,
} as const;

function windowsFor(db: DB, businessId: string) {
  return db
    .select({ weekday: availability.weekday, startMin: availability.startMin, endMin: availability.endMin })
    .from(availability)
    .where(eq(availability.businessId, businessId));
}

function busyOn(db: DB, businessId: string, date: string, timezone: string) {
  const bounds = dayBounds(date, timezone);
  if (!bounds) return Promise.resolve([] as { startsAt: number; endsAt: number }[]);
  return db
    .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.status, "confirmed"),
        lt(bookings.startsAt, bounds.end),
        gt(bookings.endsAt, bounds.start),
      ),
    );
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
 *    This is re-derived server-side; we never trust the client's idea of what is free. It also
 *    gives precise errors (slot_unavailable vs slot_taken).
 * 2. Insert. The `bookings_no_overlap` EXCLUDE constraint (see lib/migrate.ts) is the actual
 *    guarantee: Postgres refuses any confirmed booking whose time range overlaps another
 *    confirmed booking of the same business, atomically, even when two requests pass step 1
 *    at the same moment. The loser gets SQLSTATE 23P01, which we turn into `slot_taken`.
 *
 * So no application-level locking or SELECT ... FOR UPDATE is needed: the check in step 1 is
 * advisory (good errors, fewer wasted inserts), and the constraint is authoritative.
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

  const booking: Booking = {
    id: randomUUID(),
    businessId: business.id,
    serviceId: service.id,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    startsAt: input.startsAt,
    endsAt: input.startsAt + service.durationMin * 60_000,
    status: "confirmed",
    createdAt: now,
  };

  try {
    await db.insert(bookings).values(booking);
  } catch (e) {
    if (isExclusionViolation(e) || isUniqueViolation(e)) return { ok: false, reason: "slot_taken" };
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
  const filters = [eq(bookings.businessId, businessId)];
  if (scope === "upcoming") filters.push(gte(bookings.endsAt, now));
  if (scope === "past") filters.push(lt(bookings.endsAt, now));

  const rows = await db
    .select({ booking: bookings, serviceName: services.name })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(and(...filters))
    .orderBy(scope === "past" ? desc(bookings.startsAt) : asc(bookings.startsAt))
    .limit(500);

  return rows.map((r) => ({ ...r.booking, serviceName: r.serviceName }));
}

/** Cancel (idempotent). Returns null if the booking is not in this tenant. */
export async function cancelBooking(db: DB, businessId: string, bookingId: string): Promise<Booking | null> {
  const [existing] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)))
    .limit(1);
  if (!existing) return null;
  if (existing.status === "cancelled") return existing;

  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)));
  return { ...existing, status: "cancelled" };
}
