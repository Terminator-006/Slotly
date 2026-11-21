import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { ApiError, rateLimited, readJson, routeWithParams } from "@/lib/api";
import { createBooking } from "@/lib/bookings";
import { getDb } from "@/lib/db";
import { bookingConfirmedEmail, bookingOwnerAlertEmail, getMailer, safeSend } from "@/lib/mailer";
import { clientIp, limiters } from "@/lib/ratelimit";
import { businesses, services, users } from "@/lib/schema";
import { apiBooking } from "@/lib/serialize";
import { publicBookingSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = routeWithParams<{ slug: string }>(async (req, { slug }) => {
  // Cheapest check first, before we parse or touch the DB.
  const rl = limiters.booking.check(`book:${clientIp(req.headers)}`);
  if (!rl.allowed) throw rateLimited(rl.retryAfterSec);

  const input = await readJson(req, publicBookingSchema);
  const db = getDb();

  const business = db.select().from(businesses).where(eq(businesses.slug, slug)).get();
  if (!business) throw new ApiError(404, "not_found", "Business not found");
  const service = db
    .select()
    .from(services)
    .where(and(eq(services.id, input.serviceId), eq(services.businessId, business.id), eq(services.active, true)))
    .get();
  if (!service) throw new ApiError(404, "service_not_found", "Service not found");

  const result = createBooking(db, {
    business,
    service,
    startsAt: Date.parse(input.start),
    customerName: input.name,
    customerEmail: input.email,
  });

  if (!result.ok) {
    if (result.reason === "slot_taken") {
      throw new ApiError(409, "slot_taken", "That time was just booked by someone else. Please pick another.");
    }
    throw new ApiError(422, "slot_unavailable", "That time is not available for booking");
  }

  const { booking } = result;
  const mailer = getMailer();
  const owner = db
    .select()
    .from(users)
    .where(and(eq(users.businessId, business.id), eq(users.role, "owner")))
    .get();
  await safeSend(mailer, bookingConfirmedEmail(booking, business, service));
  if (owner) await safeSend(mailer, bookingOwnerAlertEmail(owner.email, booking, business, service));

  return NextResponse.json({ booking: apiBooking(booking, service.name) }, { status: 201 });
});
