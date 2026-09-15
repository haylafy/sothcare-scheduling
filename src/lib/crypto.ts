import crypto from "node:crypto";

// OAuth refresh tokens are long-lived credentials to a customer's calendar, so
// they are encrypted at rest with AES-256-GCM. TOKEN_ENCRYPTION_KEY is 32 bytes
// of base64 (openssl rand -base64 32). Rotating it invalidates stored tokens,
// which forces hosts to reconnect their calendars — by design.

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed encrypted value");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Unguessable public identifier for a booking (used in cancel/reschedule links). */
export function newBookingUid(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/** Constant-time comparison for shared secrets (cron, webhooks). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
