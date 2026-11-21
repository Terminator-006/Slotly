import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Slotly: appointment booking for small businesses", template: "%s · Slotly" },
  description: "Online booking for barbers, clinics and tutors. Timezone-correct, double-booking-proof.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 font-sans text-stone-900 antialiased">{children}</body>
    </html>
  );
}
