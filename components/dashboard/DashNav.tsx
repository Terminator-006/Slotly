"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";

const OWNER_LINKS = [
  { href: "/dashboard", label: "Bookings" },
  { href: "/dashboard/services", label: "Services" },
  { href: "/dashboard/availability", label: "Hours" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashNav({ role }: { role: "owner" | "staff" }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const links = role === "owner" ? OWNER_LINKS : OWNER_LINKS.slice(0, 1);

  async function logout() {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <nav aria-label="Dashboard" className="-mb-px flex gap-1 overflow-x-auto">
        {links.map((l) => {
          const active = l.href === "/dashboard" ? pathname === l.href : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition ${
                active ? "border-teal-700 text-teal-800" : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <button onClick={logout} disabled={busy} className="text-sm text-stone-600 hover:text-stone-900 disabled:opacity-50">
        Sign out
      </button>
    </div>
  );
}
