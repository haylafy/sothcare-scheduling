import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { googleConsentUrl } from "@/lib/google";
import { requireHost } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Start the Google OAuth consent flow.
 *
 * `state` is a single-use random nonce stored in an httpOnly cookie and
 * compared on the way back, so a crafted callback URL cannot bind an
 * attacker's Google account to someone else's host.
 */
export async function GET() {
  const host = await requireHost();
  const nonce = crypto.randomBytes(24).toString("base64url");

  const response = NextResponse.redirect(googleConsentUrl(nonce));
  response.cookies.set("google_oauth_state", `${host.id}:${nonce}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // ten minutes is plenty for a consent screen
  });
  return response;
}
