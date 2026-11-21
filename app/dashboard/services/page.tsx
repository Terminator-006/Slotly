import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ServicesManager from "@/components/dashboard/ServicesManager";
import { getServerAuth } from "@/lib/guard";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  const auth = await getServerAuth();
  if (auth?.user.role !== "owner") redirect("/dashboard"); // RBAC: staff cannot edit services
  return <ServicesManager />;
}
