import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BookingWidget from "@/components/BookingWidget";
import { Logo } from "@/components/ui";
import { getDb, NO_ID } from "@/lib/db";
import { apiBusiness, apiService } from "@/lib/serialize";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const db = await getDb();
  const business = await db.businesses.findOne({ slug }, NO_ID);
  if (!business) return null;
  const rows = await db.services.find({ businessId: business.id, active: true }, NO_ID).sort({ createdAt: 1 }).toArray();
  return { business, services: rows };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  return data ? { title: `Book at ${data.business.name}` } : { title: "Not found" };
}

export default async function PublicBookingPage({ params }: Props) {
  const { slug } = await params;
  const data = await load(slug);
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
