import type { Metadata } from "next";
import BookingsList from "@/components/dashboard/BookingsList";

export const metadata: Metadata = { title: "Bookings" };

export default function DashboardHome() {
  return <BookingsList />;
}
