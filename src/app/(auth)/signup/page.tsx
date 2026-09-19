import { redirect } from "next/navigation";
import { getCurrentHost } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { signup } from "../actions";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getCurrentHost()) redirect("/dashboard");
  return <AuthForm action={signup} mode="signup" />;
}
