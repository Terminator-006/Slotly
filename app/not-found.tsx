import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium text-teal-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-stone-600">The link may be wrong, or the business may have changed its booking URL.</p>
      <Link href="/" className="mt-6 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
        Back to Slotly
      </Link>
    </main>
  );
}
