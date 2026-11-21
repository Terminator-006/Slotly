import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import BookingWidget from "@/components/BookingWidget";
import { Logo } from "@/components/ui";
import { getDb } from "@/lib/db";
import { businesses, services } from "@/lib/schema";
import { apiBusiness, apiService } from "@/lib/serialize";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

function load(slug: string) {
  const db = getDb();
  const business = db.select().from(businesses).where(eq(businesses.slug, slug)).get();
  if (!business) return null;
  const rows = db
    .select()
    .from(services)
    .where(and(eq(services.businessId, business.id), eq(services.active, true)))
    .orderBy(asc(services.createdAt))
    .all();
  return { business, services: rows };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = load(slug);
  return data ? { title: `Book at ${data.business.name}` } : { title: "Not found" };
}

export default async function PublicBookingPage({ params }: Props) {
  const { slug } = await params;
  const data = load(slug);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <header className="mb-8 text-center">
        <p className="text-sm font-medium text-teal-700">Book an appointment</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.business.name}</h1>
        <p className="mt-2 text-sm text-stone-600">
          Pick a service and a time. All times are in {data.business.timezone.replace(/_/g, " ")}.
        </p>
      </header>

      <BookingWidget slug={slug} business={apiBusiness(data.business)} services={data.services.map(apiService)} />

      <footer className="mt-10 text-center text-xs text-stone-500">
        <Link href="/" className="inline-flex items-center gap-1.5 hover:text-stone-700">
          Powered by <Logo className="text-xs" />
        </Link>
      </footer>
    </div>
  );
}
