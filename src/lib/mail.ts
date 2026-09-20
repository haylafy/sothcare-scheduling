import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "./prisma";

/**
 * Outbound email, sent from your own domain.
 *
 * MAIL_TRANSPORT=smtp  — any SMTP relay. For sothcare.com the natural choice is
 *                        Amazon SES SMTP (the domain is already SES-verified and
 *                        amazonses.com is already in the SPF record).
 * MAIL_TRANSPORT=ses   — the SES API directly (requires @aws-sdk/client-sesv2).
 * MAIL_TRANSPORT=log   — writes to stdout. Used by tests and local dev.
 *
 * Deliverability note: SPF alone is not enough. sothcare.com must publish a
 * DKIM record for whichever sender you use, or Gmail will junk booking
 * confirmations.
 */

export interface MailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  cc?: string[];
  attachments?: MailAttachment[];
  /** For the audit trail. */
  bookingId?: string | null;
  kind?: string;
}

let transporter: Transporter | null = null;

const SEND_TIMEOUT_MS = Number(process.env.MAIL_SEND_TIMEOUT_MS || 15_000);

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} within ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function getTransport(): Promise<Transporter> {
  if (transporter) return transporter;
  const mode = (process.env.MAIL_TRANSPORT || "log").toLowerCase();

  if (mode === "ses") {
    // Resolved through a variable so the SDK stays an optional dependency —
    // SMTP users never have to install it.
    const sdk = "@aws-sdk/client-sesv2";
    const { SESv2Client, SendEmailCommand } = await import(/* webpackIgnore: true */ sdk).catch(() => {
      throw new Error("MAIL_TRANSPORT=ses requires: npm i @aws-sdk/client-sesv2");
    });
    // Fargate injects AWS_REGION=us-west-2 into every task, but the sothcare.com
    // sending identity lives in us-east-1 -- so the SES region must be pinned
    // separately or every send fails with "identity not verified".
    const ses = new SESv2Client({ region: process.env.SES_REGION || "us-east-1" });
    // This { sesClient, SendEmailCommand } shape is the nodemailer >= 7 SES v2
    // API. nodemailer 6 silently treats it as a legacy v2 SDK client and throws
    // "sendRawEmail is not a function" from inside a stream callback -- which
    // escapes every try/catch and crashes the whole server on the first send.
    transporter = nodemailer.createTransport({ SES: { sesClient: ses, SendEmailCommand } });
  } else if (mode === "smtp") {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }

  return transporter;
}

export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; error?: string }> {
  const from = process.env.MAIL_FROM || "Sothcare <no-reply@sothcare.com>";
  let ok = true;
  let error: string | undefined;

  try {
    const transport = await getTransport();
    // A hung provider must never hold a booking response open until the CDN
    // gives up (CloudFront's origin timeout is 30s). Fail the email, keep the booking.
    const info = await withTimeout(transport.sendMail({
      from,
      to: input.to,
      cc: input.cc?.length ? input.cc : undefined,
      replyTo: input.replyTo || process.env.MAIL_REPLY_TO || undefined,
      subject: input.subject,
      text: input.text,
      html: input.html ?? textToHtml(input.text),
      attachments: input.attachments,
    }), SEND_TIMEOUT_MS, "email provider did not respond");
    if ((process.env.MAIL_TRANSPORT || "log") === "log") {
      console.log(`[mail] -> ${input.to}: ${input.subject}`, (info as { messageId?: string }).messageId ?? "");
    }
  } catch (e) {
    ok = false;
    error = e instanceof Error ? e.message : String(e);
    console.error("[mail] send failed", error);
  }

  // Every send is logged, success or failure. "Did the reminder go out?" should
  // be answerable without digging through SES.
  await prisma.notificationLog
    .create({
      data: {
        bookingId: input.bookingId ?? null,
        kind: input.kind ?? "email",
        to: input.to,
        subject: input.subject,
        success: ok,
        error: error ?? null,
      },
    })
    .catch(() => undefined);

  return { ok, error };
}

/** Plain-text email wrapped in a readable, brand-coloured HTML shell. */
export function textToHtml(text: string, brandColor = "#0F766E"): string {
  // Invitee-supplied text reaches this (names, notes), so every HTML-special
  // character is escaped — quotes included, or a crafted URL could close the
  // href attribute and inject markup into mail sent from our own domain.
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const linked = escaped
    .replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      // The escaping above already removed anything that could break out.
      return `<a href="${url}" style="color:${brandColor}">${url}</a>`;
    })
    .replace(/\n/g, "<br>");

  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;color:#1a1f24;line-height:1.6;font-size:15px">
    ${linked}
  </div>
</body></html>`;
}
