import { and, asc, desc, eq, gt, lt, gte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { isConstraintError, type DB } from "./db";
import { availability, bookings, services, type Booking, type Business, type Service } from "./schema";
import { dayBounds, generateSlots, localDate, type Slot } from "./slots";

/** Anything we can run queries on: the DB itself or a transaction handle. */
type Executor = Pick<DB, "select" | "insert" | "update" | "delete">;

export const BOOKING_RULES = {
  /** Customers cannot book a slot starting in less than this many minutes. */
  minNoticeMin: 30,
  /** How far ahead the public page lets people book. */
  maxDaysAhead: 60,
} as const;

function windowsFor(db: Executor, businessId: string) {
  return db
    .select({ weekday: availability.weekday, startMin: availability.startMin, endMin: availability.endMin })
    .from(availability)
    .where(eq(availability.businessId, businessId))
    .all();
}

function busyOn(db: Executor, businessId: string, date: string, timezone: string) {
  const bounds = dayBounds(date, timezone);
  if (!bounds) return [];
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
    )
    .all();
}

/** Is `date` inside the bookable horizon (today .. today + maxDaysAhead) in the business timezone? */
export function isDateBookable(date: string, timezone: string, now: number): boolean {
  const today = localDate(now, timezone);
  const last = DateTime.fromMillis(now, { zone: timezone }).plus({ days: BOOKING_RULES.maxDaysAhead }).toISODate() ?? today;
  return date >= today && date <= last; // ISO dates compare correctly as strings
}

function computeSlots(
  db: Executor,
  business: Business,
  service: Service,
  date: string,
  now: number,
  opts: { ignoreBookings?: boolean } = {},
): Slot[] {
  if (!isDateBookable(date, business.timezone, now)) return [];
  return generateSlots({
    date,
    timezone: business.timezone,
    durationMin: service.durationMin,
    windows: windowsFor(db, business.id),
    busy: opts.ignoreBookings ? [] : busyOn(db, business.id, date, business.timezone),
    now,
    minNoticeMin: BOOKING_RULES.minNoticeMin,
  });
}

export function getFreeSlots(db: Executor, business: Business, service: Service, date: string, now = Date.now()): Slot[] {
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
 * 1. The transaction is `BEGIN IMMEDIATE`: it takes SQLite's write lock up front, so two
 *    requests cannot both read "free" and then both insert. The slot is re-derived
 *    from scratch *inside* the lock; we never trust the client's idea of what is free.
 * 2. A partial unique index (business_id, starts_at WHERE confirmed) is the safety net
 *    if anyone ever writes bookings through a path that skips step 1.
 *
 * Postgres equivalent: `SELECT ... FOR UPDATE` on the business row (or an advisory lock)
 * before the overlap check, or an EXCLUDE USING gist constraint on tstzrange(starts_at, ends_at).
 */
export function createBooking(db: DB, input: CreateBookingInput): CreateBookingResult {
  const { business, service } = input;
  const now = input.now ?? Date.now();

  try {
    return db.transaction(
      (tx) => {
        const date = localDate(input.startsAt, business.timezone);
        const free = computeSlots(tx, business, service, date, now);

        if (!free.some((s) => s.startsAt === input.startsAt)) {
          // Distinguish "someone beat you to it" from "that was never a valid slot".
          const wouldBeValid = computeSlots(tx, business, service, date, now, { ignoreBookings: true });
          return {
            ok: false as const,
            reason: wouldBeValid.some((s) => s.startsAt === input.startsAt) ? ("slot_taken" as const) : ("slot_unavailable" as const),
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
        tx.insert(bookings).values(booking).run();
        return { ok: true as const, booking };
      },
      { behavior: "immediate" },
    );
  } catch (e) {
    if (isConstraintError(e)) return { ok: false, reason: "slot_taken" };
    throw e;
  }
}

export type BookingWithService = Booking & { serviceName: string };

export function listBookings(
  db: Executor,
  businessId: string,
  scope: "upcoming" | "past" | "all",
  now = Date.now(),
): BookingWithService[] {
  const filters = [eq(bookings.businessId, businessId)];
  if (scope === "upcoming") filters.push(gte(bookings.endsAt, now));
  if (scope === "past") filters.push(lt(bookings.endsAt, now));

  const rows = db
    .select({ booking: bookings, serviceName: services.name })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(and(...filters))
    .orderBy(scope === "past" ? desc(bookings.startsAt) : asc(bookings.startsAt))
    .limit(500)
    .all();

  return rows.map((r) => ({ ...r.booking, serviceName: r.serviceName }));
}

/** Cancel (idempotent). Returns null if the booking is not in this tenant. */
export function cancelBooking(db: Executor, businessId: string, bookingId: string): Booking | null {
  const existing = db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)))
    .get();
  if (!existing) return null;
  if (existing.status === "cancelled") return existing;

  db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId)).run();
  return { ...existing, status: "cancelled" };
}
