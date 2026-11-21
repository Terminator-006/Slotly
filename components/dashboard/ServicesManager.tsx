"use client";

import { useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/client-api";
import { formatDuration, formatMoney } from "@/lib/format";
import type { ApiBusiness, ApiService } from "../types";
import { useLoad } from "../use-load";
import { Alert, Field, Spinner, btnPrimary, btnSecondary, cardCls, inputCls } from "../ui";

const toCents = (v: string) => Math.round(parseFloat(v || "0") * 100);
const toMajor = (cents: number) => (cents / 100).toFixed(2);

function ServiceForm({
  initial,
  submitLabel,
  currency,
  onSubmit,
  onCancel,
}: {
  initial?: ApiService;
  submitLabel: string;
  currency: string;
  onSubmit: (v: { name: string; durationMin: number; priceCents: number }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [duration, setDuration] = useState(String(initial?.durationMin ?? 30));
  const [price, setPrice] = useState(initial ? toMajor(initial.priceCents) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = initial?.id ?? "new";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name, durationMin: Number(duration), priceCents: toCents(price) });
      if (!initial) {
        setName("");
        setPrice("");
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
        <Field label="Name" htmlFor={`name-${uid}`}>
          <input id={`name-${uid}`} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Classic haircut" />
        </Field>
        <Field label="Minutes" htmlFor={`dur-${uid}`}>
          <input id={`dur-${uid}`} type="number" min={5} max={480} step={5} className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)} required />
        </Field>
        <Field label={`Price (${currency})`} htmlFor={`price-${uid}`}>
          <input id={`price-${uid}`} type="number" min={0} step="0.01" className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="25.00" />
        </Field>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={btnSecondary}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function ServicesManager() {
  const services = useLoad<{ services: ApiService[] }>("/api/services");
  const biz = useLoad<{ business: ApiBusiness }>("/api/business");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currency = biz.data?.business.currency ?? "USD";

  async function create(v: { name: string; durationMin: number; priceCents: number }) {
    await api("/api/services", { method: "POST", body: v });
    services.reload();
  }
  async function update(id: string, patch: Partial<ApiService>) {
    await api(`/api/services/${id}`, { method: "PATCH", body: patch });
    services.reload();
  }
  async function toggle(s: ApiService) {
    setError(null);
    try {
      await update(s.id, { active: !s.active });
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Services</h1>
        <p className="mt-1 text-sm text-stone-600">What customers can book. Archived services disappear from your booking page but keep their history.</p>
      </div>

      {error && <Alert>{error}</Alert>}
      {services.error && <Alert>{services.error}</Alert>}
      {services.loading && !services.data && <Spinner />}

      {services.data && (
        <ul className={`${cardCls} divide-y divide-stone-100`}>
          {services.data.services.length === 0 && <li className="px-5 py-10 text-center text-sm text-stone-600">No services yet. Add your first one below.</li>}
          {services.data.services.map((s) => (
            <li key={s.id} className="px-5 py-4">
              {editing === s.id ? (
                <ServiceForm
                  initial={s}
                  currency={currency}
                  submitLabel="Save changes"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (v) => {
                    await update(s.id, v);
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className={s.active ? "" : "opacity-50"}>
                    <p className="font-medium">
                      {s.name} {!s.active && <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">Archived</span>}
                    </p>
                    <p className="text-sm text-stone-600">
                      {formatDuration(s.durationMin)} · {formatMoney(s.priceCents, currency)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(s.id)} className={btnSecondary}>
                      Edit
                    </button>
                    <button onClick={() => toggle(s)} className={btnSecondary}>
                      {s.active ? "Archive" : "Restore"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={`${cardCls} p-5`}>
        <h2 className="mb-4 font-semibold">Add a service</h2>
        <ServiceForm currency={currency} submitLabel="Add service" onSubmit={create} />
      </div>
    </section>
  );
}
