"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/client-api";
import { CURRENCIES } from "@/lib/format";
import { COMMON_TIMEZONES } from "@/lib/timezones";
import type { ApiBusiness, ApiUser } from "../types";
import { useLoad } from "../use-load";
import { Alert, Field, Spinner, btnDanger, btnPrimary, cardCls, inputCls } from "../ui";

function ProfileForm() {
  const { data, error, loading } = useLoad<{ business: ApiBusiness }>("/api/business");
  const [form, setForm] = useState<ApiBusiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    if (data) setForm(data.business);
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setMsg(null);
    try {
      const { business } = await api<{ business: ApiBusiness }>("/api/business", {
        method: "PATCH",
        body: { name: form.name, slug: form.slug, timezone: form.timezone, currency: form.currency },
      });
      setForm(business);
      setMsg({ kind: "success", text: "Saved." });
    } catch (err) {
      setMsg({ kind: "error", text: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (loading || !form) return <Spinner />;

  const zones = COMMON_TIMEZONES.includes(form.timezone as never) ? [...COMMON_TIMEZONES] : [form.timezone, ...COMMON_TIMEZONES];

  return (
    <form onSubmit={save} className={`${cardCls} space-y-4 p-5`}>
      <h2 className="font-semibold">Business profile</h2>
      <Field label="Business name" htmlFor="s-name">
        <input id="s-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
      </Field>
      <Field label="Booking URL" htmlFor="s-slug" hint={`Your page: /b/${form.slug}. Changing this breaks links you've already shared.`}>
        <input
          id="s-slug"
          className={inputCls}
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
          required
          minLength={3}
          maxLength={40}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field
          label="Timezone"
          htmlFor="s-tz"
          hint="Opening hours are wall-clock times in this zone. Changing it shifts when slots happen in absolute time; existing bookings do not move."
        >
          <select id="s-tz" className={inputCls} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency" htmlFor="s-cur">
          <select id="s-cur" className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function TeamPanel() {
  const { data, error, loading, reload } = useLoad<{ users: ApiUser[] }>("/api/staff");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api("/api/staff", { method: "POST", body: { email, password } });
      setEmail("");
      setPassword("");
      reload();
    } catch (err) {
      setFormError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: ApiUser) {
    if (!window.confirm(`Remove ${u.email}? They will lose access immediately.`)) return;
    try {
      await api(`/api/staff/${u.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setFormError(describeError(err));
    }
  }

  return (
    <div className={`${cardCls} space-y-4 p-5`}>
      <div>
        <h2 className="font-semibold">Team</h2>
        <p className="mt-1 text-sm text-stone-600">Staff can see and cancel bookings. They cannot change services, hours or settings.</p>
      </div>

      {error && <Alert>{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {data.users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>
                {u.email} <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs capitalize text-stone-600">{u.role}</span>
              </span>
              {u.role === "staff" && (
                <button onClick={() => remove(u)} className={btnDanger}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Staff email" htmlFor="t-email">
          <input id="t-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Temporary password" htmlFor="t-pass">
          <input id="t-pass" type="password" autoComplete="new-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "Adding…" : "Add staff"}
        </button>
      </form>
      {formError && <Alert>{formError}</Alert>}
    </div>
  );
}

export default function SettingsForms() {
  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <ProfileForm />
      <TeamPanel />
    </section>
  );
}
