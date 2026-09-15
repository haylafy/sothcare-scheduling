import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { hubspotConsentUrl } from "@/lib/hubspot";
import { requireHost } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Start the HubSpot OAuth consent flow. Same state-nonce-in-an-httpOnly-
 * cookie CSRF defense as /api/calendars/google/connect.
 */
export async function GET() {
  const host = await requireHost();
  const nonce = crypto.randomBytes(24).toString("base64url");

  const response = NextResponse.redirect(hubspotConsentUrl(nonce));
  response.cookies.set("hubspot_oauth_state", `${host.id}:${nonce}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
