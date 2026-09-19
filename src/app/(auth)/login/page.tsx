import { redirect } from "next/navigation";
import { getCurrentHost } from "@/lib/auth";
import { AuthForm } from "../AuthForm";
import { login } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentHost()) redirect("/dashboard");
  return <AuthForm action={login} mode="login" />;
}
