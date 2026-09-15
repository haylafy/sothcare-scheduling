import { redirect } from "next/navigation";
import { BASE_PATH } from "@/lib/env";

export default function Home() {
  redirect(`${BASE_PATH()}/dashboard`);
}
