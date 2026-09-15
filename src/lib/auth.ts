import { cookies, headers } from "next/headers";
import { prisma } from "./prisma";

/**
 * Session glue — the one file to change when mounting this inside Sothcare.
 *
 * !!! READ BEFORE DEPLOYING !!!
 * `x-sothcare-user-id` is trusted, so it MUST be set by your own gateway and
 * stripped from inbound requests at the edge (ALB/CloudFront/nginx). If a
 * client can set that header, it can impersonate any host. The right fix when
 * you mount this in Sothcare is to delete `currentExternalUserId()` entirely
 * and call Sothcare's own session helper here; nothing else in the module
 * needs to change.
 *
 * The cookie fallback and the "first host" fallback are development
 * conveniences and are hard-disabled in production.
 */

const IS_PRODUCTION = process.env.NODE_ENV === "production";

async function currentExternalUserId(): Promise<string | null> {
  const h = await headers();
  const fromGateway = h.get("x-sothcare-user-id");
  if (fromGateway) return fromGateway;

  if (IS_PRODUCTION) return null;

  const c = await cookies();
  return c.get("sothcare_user_id")?.value ?? null;
}

export async function getCurrentHost() {
  const externalUserId = await currentExternalUserId();

  if (externalUserId) {
    const host = await prisma.host.findUnique({ where: { externalUserId } });
    if (host) return host;
  }

  if (!IS_PRODUCTION) {
    return prisma.host.findFirst({ orderBy: { createdAt: "asc" } });
  }

  return null;
}

export async function requireHost() {
  const host = await getCurrentHost();
  if (!host) throw new Error("Not signed in");
  return host;
}
