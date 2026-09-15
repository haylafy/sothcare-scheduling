import { NextResponse } from "next/server";
import { completeGoogleConnection } from "@/lib/google";
import { requireHost } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";
import { publicUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

function back(query: string) {
  return NextResponse.redirect(publicUrl(`/dashboard/calendars?${query}`));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return back(`error=${encodeURIComponent(error)}`);
  if (!code || !state) return back("error=missing_code");

  const host = await requireHost();

  // The nonce must match the one we issued to this browser for this host.
  const stored = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith("google_oauth_state="))
    ?.slice("google_oauth_state=".length);

  const [storedHostId, storedNonce] = decodeURIComponent(stored ?? "").split(":");
  if (!storedNonce || storedHostId !== host.id || !safeEqual(storedNonce, state)) {
    return back("error=state_mismatch");
  }

  try {
    await completeGoogleConnection(code, host.id);
    const response = back("connected=1");
    response.cookies.delete("google_oauth_state");
    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : "connection_failed";
    return back(`error=${encodeURIComponent(message)}`);
  }
}
