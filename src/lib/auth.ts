import { cookies, headers } from "next/headers";
import { prisma } from "./prisma";
import { sessionHost } from "./session";

/**
 * Session glue — the one file to change when mounting this inside Sothcare.
 *
 * !!! READ BEFORE DEPLOYING !!!
 * `x-sothcare-user-id` is trusted, so it MUST be set by your own gateway and
 * stripped from inbound requests at the edge (ALB/CloudFront/nginx). If a
 * client can set that header, it can impersonate any host.
 *
 * `sothcare_session_user_id` is the SSO cookie set by /api/auth/sso after it
 * verifies a short-lived, single-purpose token minted by Sothcare's own
 * POST /scheduling/sso-handoff (requires that app's normal login). It's
 * httpOnly and only ever written server-side after that verification, so
 * trusting it here in production is safe -- unlike the dev cookie below,
 * a browser can't set it itself.
 *
 * The `sothcare_user_id` cookie and the "first host" fallback are
 * development conveniences ONLY and are hard-disabled in production.
 */

const IS_PRODUCTION = process.env.NODE_ENV === "production";

async function currentExternalUserId(): Promise<string | null> {
  const h = await headers();
  const fromGateway = h.get("x-sothcare-user-id");
  if (fromGateway) return fromGateway;

  const c = await cookies();
  const fromSso = c.get("sothcare_session_user_id")?.value;
  if (fromSso) return fromSso;

  if (IS_PRODUCTION) return null;

  return c.get("sothcare_user_id")?.value ?? null;
}

export async function getCurrentHost() {
  // Standalone (password) accounts come first -- that's the primary way in
  // now; the Sothcare SSO paths below stay for hosts linked that way.
  const fromSession = await sessionHost();
  if (fromSession) return fromSession;

  const externalUserId = await currentExternalUserId();

  if (externalUserId) {
    const host = await prisma.host.findUnique({ where: { externalUserId } });
    if (host) return host;
  }

  // Opt-in only. This used to fire for any non-production build, which meant
  // a local dev server could never exercise the real sign-in flow -- it was
  // always already "logged in" as whichever host happened to be created first.
  if (!IS_PRODUCTION && process.env.SCHEDULING_DEV_AUTOLOGIN === "1") {
    return prisma.host.findFirst({ orderBy: { createdAt: "asc" } });
  }

  return null;
}

export async function requireHost() {
  const host = await getCurrentHost();
  if (!host) throw new Error("Not signed in");
  return host;
}