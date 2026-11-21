import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { ApiError, routeWithParams } from "@/lib/api";
import { cancelBooking } from "@/lib/bookings";
import { requireAuth } from "@/lib/guard";
import { bookingCancelledEmail, getMailer, safeSend } from "@/lib/mailer";
import { bookings, services } from "@/lib/schema";
import { apiBooking } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owners and staff can both cancel. Idempotent: cancelling twice is not an error.
export const POST = routeWithParams<{ id: string }>(async (req, { id }) => {
  const { db, business } = await requireAuth(req, ["owner", "staff"]);

  const before = db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.businessId, business.id)))
    .get();
  if (!before) throw new ApiError(404, "not_found", "Booking not found");

  const booking = cancelBooking(db, business.id, id)!;
  const service = db.select().from(services).where(eq(services.id, booking.serviceId)).get()!;

  // Only email on the transition, not on a repeated cancel.
  if (before.status === "confirmed") {
    await safeSend(getMailer(), bookingCancelledEmail(booking, business, service));
  }
  return NextResponse.json({ booking: apiBooking(booking, service.name) });
});
