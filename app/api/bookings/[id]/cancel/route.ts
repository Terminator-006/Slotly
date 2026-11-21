import { NextResponse } from "next/server";
import { ApiError, routeWithParams } from "@/lib/api";
import { cancelBooking } from "@/lib/bookings";
import { NO_ID } from "@/lib/db";
import { requireAuth } from "@/lib/guard";
import { bookingCancelledEmail, getMailer, safeSend } from "@/lib/mailer";
import { apiBooking } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owners and staff can both cancel. Idempotent: cancelling twice is not an error.
export const POST = routeWithParams<{ id: string }>(async (req, { id }) => {
  const { db, business } = await requireAuth(req, ["owner", "staff"]);

  const before = await db.bookings.findOne({ _id: id, businessId: business.id }, NO_ID);
  if (!before) throw new ApiError(404, "not_found", "Booking not found");

  const booking = (await cancelBooking(db, business.id, id))!;
  const service = (await db.services.findOne({ _id: booking.serviceId }, NO_ID))!;

  // Only email on the transition, not on a repeated cancel.
  if (before.status === "confirmed") {
    await safeSend(getMailer(), bookingCancelledEmail(booking, business, service));
  }
  return NextResponse.json({ booking: apiBooking(booking, service.name) });
});
