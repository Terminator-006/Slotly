/**
 * Document shapes (MongoDB collections). Indexes live in lib/db.ts.
 *
 * Time model: every instant is stored as a number of epoch milliseconds (UTC).
 * Availability windows are the exception: they are *local wall-clock* minutes
 * in the business timezone ("09:00" means 09:00 wherever the shop is, DST included).
 *
 * Each document's Mongo `_id` is the same string as its `id` field; reads project `_id`
 * away, so application code only ever sees `id`.
 */

export type Role = "owner" | "staff";
export type BookingStatus = "confirmed" | "cancelled";

export interface Business {
  id: string;
  name: string;
  slug: string;
  timezone: string; // IANA, e.g. "Europe/Berlin"
  currency: string;
  createdAt: number;
}

export interface User {
  id: string;
  businessId: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: number;
}

export interface Service {
  id: string;
  businessId: string;
  name: string;
  durationMin: number;
  priceCents: number;
  // Services are archived, never deleted: bookings reference them.
  active: boolean;
  createdAt: number;
}

export interface AvailabilityRow {
  id: string;
  businessId: string;
  weekday: number; // ISO: 1 = Monday ... 7 = Sunday
  startMin: number; // minutes after local midnight
  endMin: number; // exclusive, max 1440
}

export interface Booking {
  id: string;
  businessId: string;
  serviceId: string;
  customerName: string;
  customerEmail: string;
  startsAt: number; // epoch ms, UTC
  endsAt: number; // epoch ms, UTC
  status: BookingStatus;
  createdAt: number;
}

/**
 * One document per minute of a confirmed booking. `_id` is `${businessId}:${minuteIndex}`,
 * so MongoDB's own unique `_id` guarantee makes "claim this minute" an atomic operation:
 * two overlapping bookings can never both hold every minute they need.
 */
export interface BookingLock {
  _id: string;
  businessId: string;
  bookingId: string;
  createdAt: number;
  /** TTL index target: old locks are garbage-collected by MongoDB itself. */
  expireAt: Date;
}
