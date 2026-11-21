"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/client-api";
import { formatDuration, formatMoney } from "@/lib/format";
import type { ApiBooking, ApiBusiness, ApiService } from "./types";
import { Alert, Field, Spinner, btnPrimary, btnSecondary, cardCls, inputCls } from "./ui";

interface Slot {
  start: string;
  end: string;
  local: string;
}

const MAX_DAYS = 60;

/** Today's calendar date ("YYYY-MM-DD") in the *business* timezone, not the visitor's. */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Pure calendar arithmetic on "YYYY-MM-DD" strings (UTC avoids any DST surprises). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(date: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

function StepHeading({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-900">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-700 text-xs text-white">{n}</span>
      {children}
    </h2>
  );
}

export default function BookingWidget({
  slug,
  business,
  services,
}: {
  slug: string;
  business: ApiBusiness;
  services: ApiService[];
}) {
  const tzLabel = business.timezone.replace(/_/g, " ");

  const [serviceId, setServiceId] = useState<string | null>(services.length === 1 ? services[0]!.id : null);
  const [today, setToday] = useState<string | null>(null);
  const [daysShown, setDaysShown] = useState(14);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [picked, setPicked] = useState<Slot | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ApiBooking | null>(null);

  const service = useMemo(() => services.find((s) => s.id === serviceId) ?? null, [services, serviceId]);

  // Computed after mount so server and client markup match.
  useEffect(() => setToday(todayIn(business.timezone)), [business.timezone]);

  // Load free slots whenever the service/date changes (or after a conflict).
  useEffect(() => {
    if (!serviceId || !date) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);
    api<{ slots: Slot[] }>(`/api/public/${slug}/slots?serviceId=${encodeURIComponent(serviceId)}&date=${date}`)
      .then((r) => !cancelled && setSlots(r.slots))
      .catch((e) => !cancelled && (setSlotsError(describeError(e)), setSlots(null)))
      .finally(() => !cancelled && setSlotsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug, serviceId, date, refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!serviceId || !picked) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { booking } = await api<{ booking: ApiBooking }>(`/api/public/${slug}/bookings`, {
        method: "POST",
        body: { serviceId, start: picked.start, name, email },
      });
      setConfirmed(booking);
    } catch (err) {
      setSubmitError(describeError(err));
      // Someone else got there first: drop the stale slot and show what's still free.
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "slot_taken") {
        setPicked(null);
        setRefresh((n) => n + 1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setConfirmed(null);
    setPicked(null);
    setName("");
    setEmail("");
    setRefresh((n) => n + 1);
  }

  // ---- Confirmation ---------------------------------------------------------------------------
  if (confirmed && service) {
    const when = new Date(confirmed.start);
    const shopTime = when.toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: business.timezone,
    });
    return (
      <div className={`${cardCls} p-8 text-center`}>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-teal-100 text-teal-800" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">You&apos;re booked, {confirmed.customerName.split(" ")[0]}!</h2>
        <p className="mt-2 text-stone-700">
          {service.name} at {business.name}
        </p>
        <p className="mt-1 text-lg font-medium">{shopTime}</p>
        <p className="text-sm text-stone-500">{tzLabel} time</p>
        <p className="mt-4 text-sm text-stone-600">A confirmation was sent to {confirmed.customerEmail}.</p>
        <button onClick={reset} className={`${btnSecondary} mt-6`}>
          Book another time
        </button>
      </div>
    );
  }

  // ---- Booking flow ---------------------------------------------------------------------------
  const visibleDays = today ? Array.from({ length: Math.min(daysShown, MAX_DAYS + 1) }, (_, i) => addDays(today, i)) : [];

  const customerTime = picked
    ? new Date(picked.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;
  const differsFromShop = picked && customerTime !== picked.local;

  return (
    <div className="space-y-8">
      <section className={`${cardCls} p-5 sm:p-6`}>
        <StepHeading n={1}>Choose a service</StepHeading>
        {services.length === 0 ? (
          <Alert kind="info">This business hasn&apos;t added any services yet.</Alert>
        ) : (
          <div role="radiogroup" aria-label="Service" className="grid gap-2">
            {services.map((s) => {
              const selected = s.id === serviceId;
              return (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setServiceId(s.id);
                    setPicked(null);
                    setSlots(null);
                  }}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                    selected ? "border-teal-600 bg-teal-50 ring-1 ring-teal-600" : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <span>
                    <span className="block font-medium">{s.name}</span>
                    <span className="text-sm text-stone-600">{formatDuration(s.durationMin)}</span>
                  </span>
                  <span className="font-medium tabular-nums">{formatMoney(s.priceCents, business.currency)}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {service && (
        <section className={`${cardCls} p-5 sm:p-6`}>
          <StepHeading n={2}>Pick a day</StepHeading>
          {!today ? (
            <Spinner />
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {visibleDays.map((d, i) => {
                  const selected = d === date;
                  return (
                    <button
                      key={d}
                      aria-pressed={selected}
                      onClick={() => {
                        setDate(d);
                        setPicked(null);
                      }}
                      className={`rounded-xl border px-2 py-2.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                        selected ? "border-teal-700 bg-teal-700 text-white" : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                      }`}
                    >
                      <span className={`block text-xs ${selected ? "text-teal-100" : "text-stone-500"}`}>
                        {i === 0 ? "Today" : dayLabel(d, { weekday: "short" })}
                      </span>
                      <span className="block text-lg font-semibold leading-tight">{dayLabel(d, { day: "numeric" })}</span>
                      <span className={`block text-xs ${selected ? "text-teal-100" : "text-stone-500"}`}>{dayLabel(d, { month: "short" })}</span>
                    </button>
                  );
                })}
              </div>
              {daysShown <= MAX_DAYS && (
                <button className="mt-3 text-sm font-medium text-teal-700 hover:underline" onClick={() => setDaysShown((n) => n + 14)}>
                  Show more dates
                </button>
              )}
            </>
          )}
        </section>
      )}

      {service && date && (
        <section className={`${cardCls} p-5 sm:p-6`}>
          <StepHeading n={3}>Pick a time</StepHeading>
          <p className="-mt-1 mb-3 text-sm text-stone-600">
            {dayLabel(date, { weekday: "long", day: "numeric", month: "long" })} · times in {tzLabel}
          </p>
          {slotsLoading && <Spinner label="Finding free times" />}
          {slotsError && <Alert>{slotsError}</Alert>}
          {!slotsLoading && slots && slots.length === 0 && (
            <Alert kind="info">No free times on this day. Try another date.</Alert>
          )}
          {slots && slots.length > 0 && (
            <div className={`grid grid-cols-3 gap-2 sm:grid-cols-5 ${slotsLoading ? "opacity-50" : ""}`} role="group" aria-label="Available times">
              {slots.map((s) => {
                const selected = picked?.start === s.start;
                return (
                  <button
                    key={s.start}
                    aria-pressed={selected}
                    onClick={() => setPicked(s)}
                    className={`rounded-lg border px-2 py-2 text-sm font-medium tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                      selected ? "border-teal-700 bg-teal-700 text-white" : "border-stone-200 hover:border-teal-600 hover:bg-teal-50"
                    }`}
                  >
                    {s.local}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {service && picked && (
        <form onSubmit={submit} className={`${cardCls} space-y-4 p-5 sm:p-6`}>
          <StepHeading n={4}>Your details</StepHeading>

          <div className="rounded-lg bg-stone-50 px-4 py-3 text-sm">
            <p className="font-medium">
              {service.name} · {dayLabel(date!, { weekday: "short", day: "numeric", month: "short" })} at {picked.local}
            </p>
            <p className="text-stone-600">
              {tzLabel} time{differsFromShop ? ` · that's ${customerTime} where you are` : ""}
            </p>
          </div>

          <Field label="Your name" htmlFor="c-name">
            <input id="c-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="name" />
          </Field>
          <Field label="Email" htmlFor="c-email" hint="We'll send your confirmation here.">
            <input id="c-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>

          {submitError && <Alert>{submitError}</Alert>}
          <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
            {submitting ? "Booking…" : `Confirm booking · ${formatMoney(service.priceCents, business.currency)}`}
          </button>
          <p className="text-center text-xs text-stone-500">Pay at the appointment. No account needed.</p>
        </form>
      )}
    </div>
  );
}
