"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/client-api";
import type { ApiBooking } from "../types";
import { useLoad } from "../use-load";
import { Alert, Spinner, btnDanger, cardCls } from "../ui";

type Scope = "upcoming" | "past" | "all";
const SCOPES: { id: Scope; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
];

function whenParts(iso: string, timeZone: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }),
  };
}

export default function BookingsList() {
  const [scope, setScope] = useState<Scope>("upcoming");
  const { data, error, loading, reload } = useLoad<{ timezone: string; bookings: ApiBooking[] }>(`/api/bookings?scope=${scope}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function cancel(b: ApiBooking) {
    if (!window.confirm(`Cancel ${b.customerName}'s ${b.serviceName ?? "booking"}? They will be emailed.`)) return;
    setCancelling(b.id);
    setActionError(null);
    try {
      await api(`/api/bookings/${b.id}/cancel`, { method: "POST" });
      reload();
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setCancelling(null);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Bookings</h1>
          {data && <p className="mt-1 text-sm text-stone-600">Times shown in {data.timezone.replace(/_/g, " ")}.</p>}
        </div>
        <div role="tablist" aria-label="Filter bookings" className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-sm">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={scope === s.id}
              onClick={() => setScope(s.id)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                scope === s.id ? "bg-teal-700 text-white" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {actionError && <Alert>{actionError}</Alert>}
        {error && <Alert>{error}</Alert>}
        {loading && !data && <Spinner />}

        {data && data.bookings.length === 0 && (
          <div className={`${cardCls} px-6 py-12 text-center`}>
            <p className="font-medium">No {scope === "all" ? "" : scope} bookings yet</p>
            <p className="mt-1 text-sm text-stone-600">Share your booking page and they will show up here.</p>
          </div>
        )}

        {data && data.bookings.length > 0 && (
          <ul className={`${cardCls} divide-y divide-stone-100 ${loading ? "opacity-60" : ""}`}>
            {data.bookings.map((b) => {
              const w = whenParts(b.start, data.timezone);
              const cancelled = b.status === "cancelled";
              const isPast = new Date(b.end).getTime() < Date.now();
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="w-24 shrink-0">
                      <p className={`text-sm font-medium ${cancelled ? "text-stone-400 line-through" : ""}`}>{w.date}</p>
                      <p className="text-sm tabular-nums text-stone-600">{w.time}</p>
                    </div>
                    <div className="min-w-0">
                      <p className={`truncate font-medium ${cancelled ? "text-stone-400 line-through" : ""}`}>{b.customerName}</p>
                      <p className="truncate text-sm text-stone-600">
                        {b.serviceName} · {b.customerEmail}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {cancelled ? (
                      <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">Cancelled</span>
                    ) : isPast ? (
                      <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">Done</span>
                    ) : (
                      <>
                        <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-800">Confirmed</span>
                        <button onClick={() => cancel(b)} disabled={cancelling === b.id} className={btnDanger}>
                          {cancelling === b.id ? "Cancelling…" : "Cancel"}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
