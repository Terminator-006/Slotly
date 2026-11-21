import Link from "next/link";
import { redirect } from "next/navigation";
import DashNav from "@/components/dashboard/DashNav";
import { Logo } from "@/components/ui";
import { getServerAuth } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await getServerAuth();
  if (!auth) redirect("/login");
  const { business, user } = auth;

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-5xl px-6">
          <div className="flex items-center justify-between py-4">
            <Link href="/dashboard" aria-label="Slotly dashboard">
              <Logo />
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-stone-600 sm:inline">{business.name}</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium capitalize text-stone-700">{user.role}</span>
              <Link
                href={`/b/${business.slug}`}
                target="_blank"
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50"
              >
                View booking page ↗
              </Link>
            </div>
          </div>
          <DashNav role={user.role} />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
