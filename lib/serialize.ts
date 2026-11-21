import type { Booking, Business, Service, User } from "./schema";

/** Shapes returned by the JSON API. Instants go out as ISO-8601 UTC strings. */

const iso = (ms: number) => new Date(ms).toISOString();

export const apiUser = (u: User) => ({ id: u.id, email: u.email, role: u.role });

export const apiBusiness = (b: Business) => ({
  id: b.id,
  name: b.name,
  slug: b.slug,
  timezone: b.timezone,
  currency: b.currency,
});

export const apiService = (s: Service) => ({
  id: s.id,
  name: s.name,
  durationMin: s.durationMin,
  priceCents: s.priceCents,
  active: s.active,
});

export const apiBooking = (b: Booking, serviceName?: string) => ({
  id: b.id,
  serviceId: b.serviceId,
  serviceName,
  customerName: b.customerName,
  customerEmail: b.customerEmail,
  start: iso(b.startsAt),
  end: iso(b.endsAt),
  status: b.status,
  createdAt: iso(b.createdAt),
});
