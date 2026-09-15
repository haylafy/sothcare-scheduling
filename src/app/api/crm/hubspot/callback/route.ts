import { NextResponse } from "next/server";
import { completeHubSpotConnection } from "@/lib/hubspot";
import { requireHost } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";
import { publicUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

function back(query: string) {
  return NextResponse.redirect(publicUrl(`/dashboard/integrations?${query}`));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return back(`error=${encodeURIComponent(error)}`);
  if (!code || !state) return back("error=missing_code");

  const host = await requireHost();

  const stored = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith("hubspot_oauth_state="))
    ?.slice("hubspot_oauth_state=".length);

  const [storedHostId, storedNonce] = decodeURIComponent(stored ?? "").split(":");
  if (!storedNonce || storedHostId !== host.id || !safeEqual(storedNonce, state)) {
    return back("error=state_mismatch");
  }

  try {
    await completeHubSpotConnection(code, host.id);
    const response = back("connected=1");
    response.cookies.delete("hubspot_oauth_state");
    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : "connection_failed";
    return back(`error=${encodeURIComponent(message)}`);
  }
}
