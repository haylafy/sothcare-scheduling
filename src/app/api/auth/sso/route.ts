import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { publicUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Exchanges a short-lived SSO handoff token (minted by Sothcare's own
 * POST /scheduling/sso-handoff, requires that app's normal login) for a
 * session cookie on THIS origin. See src/lib/auth.ts for why this exists --
 * a separate origin has no visibility into Sothcare's localStorage session.
 *
 * The token is signed with the same JWT_SECRET Sothcare's backend uses,
 * expires in 60 seconds, and carries a distinct `type` so it can't be
 * replayed against any Sothcare API endpoint (or vice versa).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return NextResponse.redirect(publicUrl("/dashboard?error=missing_token"));

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[auth/sso] JWT_SECRET is not configured");
    return NextResponse.redirect(publicUrl("/dashboard?error=sso_not_configured"));
  }

  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
  } catch {
    return NextResponse.redirect(publicUrl("/dashboard?error=invalid_or_expired_token"));
  }

  if (decoded.type !== "scheduling-sso" || typeof decoded.userId !== "string") {
    return NextResponse.redirect(publicUrl("/dashboard?error=invalid_token_type"));
  }

  const response = NextResponse.redirect(publicUrl("/dashboard"));
  response.cookies.set("sothcare_session_user_id", decoded.userId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
  return response;
}
