import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const SESSION_COOKIE = "scheduling_session";
const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/**
 * Issues a session row + sets its cookie. The token is the only secret: it is
 * random, stored as-is server-side, and looked up on each request, so signing
 * out deletes the row and the cookie stops working immediately.
 */
export async function startSession(hostId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({ data: { token, hostId, expiresAt } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

/** The host behind the current session cookie, or null. Expired rows are ignored. */
export async function sessionHost() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { host: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return session.host;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  jar.delete(SESSION_COOKIE);
}

/** Every session for a host -- used after a password change. */
export async function endAllSessions(hostId: string) {
  await prisma.session.deleteMany({ where: { hostId } });
}
