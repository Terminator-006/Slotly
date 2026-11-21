import { NextResponse } from "next/server";
import { readQuery, route } from "@/lib/api";
import { listBookings } from "@/lib/bookings";
import { requireAuth } from "@/lib/guard";
import { apiBooking } from "@/lib/serialize";
import { bookingsQuerySchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { db, business } = await requireAuth(req);
  const { scope } = readQuery(req, bookingsQuerySchema);
  const rows = listBookings(db, business.id, scope);
  return NextResponse.json({
    timezone: business.timezone,
    bookings: rows.map((b) => apiBooking(b, b.serviceName)),
  });
});
