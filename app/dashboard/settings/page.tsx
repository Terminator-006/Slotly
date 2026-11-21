import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SettingsForms from "@/components/dashboard/SettingsForms";
import { getServerAuth } from "@/lib/guard";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await getServerAuth();
  if (auth?.user.role !== "owner") redirect("/dashboard");
  return <SettingsForms />;
}
