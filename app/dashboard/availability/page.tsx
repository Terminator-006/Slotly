import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AvailabilityEditor from "@/components/dashboard/AvailabilityEditor";
import { getServerAuth } from "@/lib/guard";

export const metadata: Metadata = { title: "Opening hours" };

export default async function AvailabilityPage() {
  const auth = await getServerAuth();
  if (auth?.user.role !== "owner") redirect("/dashboard");
  return <AvailabilityEditor />;
}
