import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getServerAuth } from "@/lib/guard";

export const metadata: Metadata = { title: "Create your booking page" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getServerAuth()) redirect("/dashboard");
  return <AuthForm mode="signup" />;
}
