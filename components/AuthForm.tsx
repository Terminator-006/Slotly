"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/client-api";
import { CURRENCIES } from "@/lib/format";
import { COMMON_TIMEZONES } from "@/lib/timezones";
import { Alert, Field, Logo, btnPrimary, inputCls } from "./ui";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [zones, setZones] = useState<string[]>([...COMMON_TIMEZONES]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Detect the browser timezone after mount (doing it during render would break hydration).
  useEffect(() => {
    if (mode !== "signup") return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected) return;
    setZones((z) => (z.includes(detected) ? z : [detected, ...z]));
    setTimezone(detected);
  }, [mode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        body: mode === "login" ? { email, password } : { email, password, businessName, slug, timezone, currency },
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 self-center">
        <Logo className="text-xl" />
      </Link>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{isSignup ? "Create your booking page" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-stone-600">
          {isSignup ? "Free while it's a portfolio project." : "Sign in to manage your bookings."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {isSignup && (
            <>
              <Field label="Business name" htmlFor="businessName">
                <input
                  id="businessName"
                  className={inputCls}
                  value={businessName}
                  onChange={(e) => {
                    setBusinessName(e.target.value);
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                  placeholder="Fade & Co Barbers"
                  required
                  maxLength={80}
                />
              </Field>
              <Field label="Booking URL" htmlFor="slug" hint={`Customers will book at /b/${slug || "your-name"}`}>
                <input
                  id="slug"
                  className={inputCls}
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="fade-and-co"
                  required
                  minLength={3}
                  maxLength={40}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  title="Lowercase letters, numbers and single hyphens"
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="Timezone" htmlFor="timezone">
                    <select id="timezone" className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                      {zones.map((z) => (
                        <option key={z} value={z}>
                          {z.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Currency" htmlFor="currency">
                  <select
                    id="currency"
                    className={inputCls}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          )}

          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password" hint={isSignup ? "At least 8 characters" : undefined}>
            <input
              id="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isSignup ? 8 : 1}
              maxLength={128}
            />
          </Field>

          {error && <Alert>{error}</Alert>}

          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
            {busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        {!isSignup && (
          <button
            type="button"
            className="mt-3 w-full text-center text-xs text-stone-500 underline-offset-2 hover:underline"
            onClick={() => {
              setEmail("demo@slotly.dev");
              setPassword("demo1234");
            }}
          >
            Fill in the demo account
          </button>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-stone-600">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-teal-700 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-medium text-teal-700 hover:underline">
              Create a booking page
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
