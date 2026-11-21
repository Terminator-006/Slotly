import Link from "next/link";
import { Logo, btnPrimary, btnSecondary } from "@/components/ui";

const features = [
  {
    title: "Never double-booked",
    body: "Every booking is checked against existing ones inside a database write lock, with a unique index as a safety net.",
  },
  {
    title: "Timezone-correct",
    body: "Opening hours follow the shop's clock, DST included. Bookings are stored in UTC, so nothing drifts.",
  },
  {
    title: "Live in five minutes",
    body: "Sign up, add services, set weekly hours, share one link. Customers book without creating an account.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-6">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/login" className="font-medium text-stone-700 hover:text-stone-900">
            Sign in
          </Link>
          <Link href="/signup" className={btnPrimary}>
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="py-16 text-center sm:py-24">
          <p className="mx-auto w-fit rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
            Appointment booking for barbers, clinics and tutors
          </p>
          <h1 className="mx-auto mt-6 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Let customers book you, <span className="text-teal-700">not the other way round.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-stone-600">
            A simple booking page for your business. Set your hours once, share a link, and watch the calendar fill up.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className={btnPrimary}>
              Create your booking page
            </Link>
            <Link href="/b/demo-barber" className={btnSecondary}>
              Try the live demo
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
              <h2 className="font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-stone-200 py-8 text-center text-sm text-stone-500">
        Slotly is an open-source portfolio project. The demo database resets regularly: please don&apos;t enter real personal data.
      </footer>
    </div>
  );
}
