import { DateTime } from "luxon";

/**
 * Email-safe HTML layout for every notification the module sends.
 *
 * Rules that keep this rendering in Gmail, Outlook and Apple Mail alike:
 * tables for structure, every colour and size inline, a single 600px column,
 * system fonts, no external CSS. The <style> block only carries progressive
 * enhancements (dark mode, phone padding) that clients may ignore.
 *
 * Everything dynamic passes through esc() -- invitee names and notes are
 * user input and this HTML is sent from our own domain.
 */

export interface EmailBrand {
  orgName: string;
  /** Absolute URL of a small, light-background logo. Falls back to a text wordmark. */
  logoUrl: string | null;
  brandColor: string;
  accentTextOn: string;
  siteUrl: string;
  siteLabel: string;
  /** Host.showPoweredBy -- suppressed automatically when the org *is* Sothcare. */
  poweredBy: boolean;
}

export type StatusTone = "green" | "amber" | "red" | "blue" | "slate";
export interface EmailStatus {
  label: string;
  tone: StatusTone;
}

export interface EmailPerson {
  name: string;
  subline?: string | null;
  avatarUrl?: string | null;
}

export interface EmailLocation {
  label: string;
  sublabel?: string | null;
  glyph: string;
  glyphBg: string;
  glyphFg: string;
}

export interface EmailEventCard {
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  durationMinutes: number;
  previousStartsAt?: Date | null;
  person?: EmailPerson | null;
  location?: EmailLocation | null;
  cancelled?: boolean;
  cta?: { label: string; url: string } | null;
}

export interface EmailNote {
  heading: string;
  paragraphs: string[];
  highlight?: string | null;
}

export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailLayout {
  brand: EmailBrand;
  preheader: string;
  status: EmailStatus;
  headline: string;
  intro: string[];
  card?: EmailEventCard | null;
  note?: EmailNote | null;
  details?: EmailDetail[] | null;
  calendar?: { google: string; outlook: string; ics: string } | null;
  manage?: {
    text?: string | null;
    rescheduleUrl?: string | null;
    cancelUrl?: string | null;
    bookAgainUrl?: string | null;
  } | null;
  footer: {
    why: string;
    timezone?: string | null;
    replyHint?: string | null;
  };
}

const TONES: Record<StatusTone, { bg: string; fg: string }> = {
  green: { bg: "#DCFCE7", fg: "#166534" },
  amber: { bg: "#FEF3C7", fg: "#92400E" },
  red: { bg: "#FEE2E2", fg: "#991B1B" },
  blue: { bg: "#DBEAFE", fg: "#1E40AF" },
  slate: { bg: "#E2E8F0", fg: "#334155" },
};

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const INK = "#101828";
const BODY = "#344054";
const MUTED = "#667085";
const CARD_BG = "#f7f9fa";
const CARD_BORDER = "#e6ebef";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) URLs may become hrefs; anything else renders as inert text. */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? esc(url) : "#";
}

/** Image sources: https, or an inline PNG/JPEG/GIF (used by the preview script). */
function safeSrc(url: string): string {
  return /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(url) ? esc(url) : "";
}

/** A hex colour or nothing -- never let a stored value inject CSS. */
function safeColor(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letters.join("") || "?";
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function formatTimeRange(start: Date, end: Date, timezone: string): string {
  const s = DateTime.fromJSDate(start).setZone(timezone);
  const e = DateTime.fromJSDate(end).setZone(timezone);
  const sameMeridiem = s.toFormat("a") === e.toFormat("a");
  return `${s.toFormat(sameMeridiem ? "h:mm" : "h:mm a")} – ${e.toFormat("h:mm a")}`;
}

export function formatZone(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat("ZZZZ");
}

function paragraphs(items: string[], style: string): string {
  return items
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p class="t" style="${style}">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function button(label: string, url: string, brand: EmailBrand, variant: "primary" | "ghost", block = false): string {
  const color = safeColor(brand.brandColor, "#0F766E");
  const onColor = safeColor(brand.accentTextOn, "#FFFFFF");
  const base = `display:${block ? "block" : "inline-block"};text-align:center;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:10px;font-family:${FONT}`;
  const style =
    variant === "primary"
      ? `${base};background:${color};color:${onColor}`
      : `${base};background:#ffffff;color:${color};border:1.5px solid ${CARD_BORDER}`;
  return `<a class="${variant === "ghost" ? "ghost" : ""}" href="${safeHref(url)}" style="${style}">${esc(label)}</a>`;
}

function section(inner: string, padding = "22px 36px 0 36px"): string {
  return `<tr><td class="pad" style="padding:${padding}">${inner}</td></tr>`;
}

function renderHeader(brand: EmailBrand, status: EmailStatus): string {
  const tone = TONES[status.tone];
  const logo = brand.logoUrl
    ? `<a href="${safeHref(brand.siteUrl)}" style="text-decoration:none"><img src="${safeSrc(brand.logoUrl)}" alt="${esc(brand.orgName)}" height="64" style="display:block;height:64px;width:auto;border:0;outline:none"></a>`
    : `<a href="${safeHref(brand.siteUrl)}" class="t" style="text-decoration:none;font-size:20px;font-weight:800;color:${INK};letter-spacing:-.01em;font-family:${FONT}">${esc(brand.orgName)}</a>`;
  return section(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle">${logo}</td>
      <td style="text-align:right;vertical-align:middle"><span style="display:inline-block;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:6px 10px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-family:${FONT}">${esc(status.label)}</span></td>
    </tr></table>`,
    "26px 36px 0 36px",
  );
}

function renderPersonRow(person: EmailPerson, brand: EmailBrand): string {
  const color = safeColor(brand.brandColor, "#0F766E");
  const avatar = person.avatarUrl
    ? `<img src="${safeSrc(person.avatarUrl)}" alt="" width="32" height="32" style="display:block;width:32px;height:32px;border-radius:50%;border:0">`
    : `<span style="display:inline-block;width:32px;height:32px;border-radius:50%;background:#eef2f5;color:${color};font-weight:700;font-size:13px;line-height:32px;text-align:center;font-family:${FONT}">${esc(initials(person.name))}</span>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>
    <td style="vertical-align:middle">${avatar}</td>
    <td style="vertical-align:middle;padding-left:10px">
      <div class="t" style="font-size:14px;font-weight:600;color:${INK};font-family:${FONT}">${esc(person.name)}</div>
      ${person.subline ? `<div class="muted" style="font-size:12.5px;color:${MUTED};font-family:${FONT}">${esc(person.subline)}</div>` : ""}
    </td>
  </tr></table>`;
}

function renderLocationRow(location: EmailLocation): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>
    <td style="vertical-align:middle"><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:${safeColor(location.glyphBg, "#eef2f5")};color:${safeColor(location.glyphFg, INK)};font-weight:800;font-size:12px;line-height:32px;text-align:center;font-family:${FONT}">${esc(location.glyph)}</span></td>
    <td style="vertical-align:middle;padding-left:10px">
      <div class="t" style="font-size:14px;font-weight:600;color:${INK};font-family:${FONT}">${esc(location.label)}</div>
      ${location.sublabel ? `<div class="muted" style="font-size:12.5px;color:${MUTED};font-family:${FONT}">${esc(location.sublabel)}</div>` : ""}
    </td>
  </tr></table>`;
}

function renderCard(card: EmailEventCard, brand: EmailBrand): string {
  const color = safeColor(brand.brandColor, "#0F766E");
  const onColor = safeColor(brand.accentTextOn, "#FFFFFF");
  const start = DateTime.fromJSDate(card.startsAt).setZone(card.timezone);
  const range = formatTimeRange(card.startsAt, card.endsAt, card.timezone);
  const zone = formatZone(card.startsAt, card.timezone);
  const timeStyle = card.cancelled ? `text-decoration:line-through;color:${MUTED}` : `color:#1d2939`;
  const previous = card.previousStartsAt
    ? `<div class="muted" style="font-size:13px;margin-top:4px;color:${MUTED};font-family:${FONT}">Previously <span style="text-decoration:line-through;color:#98a2b3">${esc(
        DateTime.fromJSDate(card.previousStartsAt).setZone(card.timezone).toFormat("ccc, LLL d · h:mm a ZZZZ"),
      )}</span></div>`
    : "";
  const dateBoxBg = card.cancelled ? "#98a2b3" : color;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="evt" style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:14px">
    <tr>
      <td style="padding:22px 22px 18px 22px;vertical-align:top" width="76">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:76px;background:${dateBoxBg};border-radius:12px;color:${onColor}">
          <tr><td style="padding:8px 0 0 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-align:center;color:${onColor};font-family:${FONT}">${esc(start.toFormat("ccc"))}</td></tr>
          <tr><td style="padding:0;font-size:30px;font-weight:800;line-height:1.1;text-align:center;color:${onColor};font-family:${FONT}">${esc(start.toFormat("d"))}</td></tr>
          <tr><td style="padding:0 0 9px 0;font-size:12px;font-weight:600;text-align:center;color:${onColor};font-family:${FONT}">${esc(start.toFormat("LLL"))}</td></tr>
        </table>
      </td>
      <td style="padding:22px 22px 18px 4px;vertical-align:top">
        <div class="t" style="font-size:18px;font-weight:700;color:${INK};line-height:1.3;font-family:${FONT}">${esc(card.title)}</div>
        <div class="t" style="font-size:16px;margin-top:6px;font-weight:600;${timeStyle};font-family:${FONT}">${esc(range)} <span class="muted" style="font-weight:500;color:${MUTED}">${esc(zone)} · ${esc(formatDuration(card.durationMinutes))}</span></div>
        ${previous}
        ${card.person ? renderPersonRow(card.person, brand) : ""}
        ${card.location ? renderLocationRow(card.location) : ""}
      </td>
    </tr>
    ${card.cta ? `<tr><td colspan="2" style="padding:0 22px 20px 22px">${button(card.cta.label, card.cta.url, brand, "primary", true)}</td></tr>` : ""}
  </table>`;
}

function renderNote(note: EmailNote, brand: EmailBrand): string {
  const color = safeColor(brand.brandColor, "#0F766E");
  const highlight = note.highlight
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>
        <td style="vertical-align:top;padding-right:10px;font-size:16px;line-height:1.4">&#128187;</td>
        <td class="t" style="vertical-align:top;font-size:14.5px;line-height:1.55;color:#1d2939;font-weight:600;font-family:${FONT}">${esc(note.highlight)}</td>
      </tr></table>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="evt" style="border-left:3px solid ${color};background:${CARD_BG};border-radius:0 12px 12px 0">
    <tr><td style="padding:16px 20px 18px 20px">
      <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;color:${MUTED};font-family:${FONT}">${esc(note.heading)}</div>
      ${paragraphs(note.paragraphs, `margin:0 0 10px 0;font-size:15px;line-height:1.65;color:${BODY};font-family:${FONT}`)}
      ${highlight}
    </td></tr>
  </table>`;
}

function renderDetails(details: EmailDetail[]): string {
  const rows = details
    .filter((d) => d.value.trim().length > 0)
    .map(
      (d) => `<tr>
        <td class="muted" style="padding:8px 0;font-size:13px;color:${MUTED};vertical-align:top;width:120px;font-family:${FONT}">${esc(d.label)}</td>
        <td class="t" style="padding:8px 0;font-size:14px;color:${INK};vertical-align:top;font-family:${FONT}">${esc(d.value).replace(/\n/g, "<br>")}</td>
      </tr>`,
    )
    .join("");
  if (!rows) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${CARD_BORDER}"><tr><td style="padding-top:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
}

function chip(label: string, url: string): string {
  return `<a class="chip" href="${safeHref(url)}" style="display:inline-block;text-decoration:none;font-size:13px;font-weight:600;color:#1a1f24;background:#f2f5f7;border:1px solid #e4e9ee;padding:9px 12px;border-radius:8px;font-family:${FONT}">${esc(label)}</a>`;
}

export function renderEmailLayout(input: EmailLayout): string {
  const { brand } = input;
  const color = safeColor(brand.brandColor, "#0F766E");
  const parts: string[] = [];

  parts.push(`<tr><td style="background:${color};height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>`);
  parts.push(renderHeader(brand, input.status));
  parts.push(
    section(
      `<h1 class="t" style="margin:0 0 10px 0;font-size:26px;line-height:1.25;font-weight:800;color:${INK};letter-spacing:-.01em;font-family:${FONT}">${esc(input.headline)}</h1>
       ${paragraphs(input.intro, `margin:0 0 8px 0;font-size:16px;line-height:1.6;color:${BODY};font-family:${FONT}`)}`,
      "28px 36px 8px 36px",
    ),
  );
  if (input.card) parts.push(section(renderCard(input.card, brand)));
  if (input.note && (input.note.paragraphs.some((p) => p.trim()) || input.note.highlight)) {
    parts.push(section(renderNote(input.note, brand)));
  }
  if (input.details?.length) parts.push(section(renderDetails(input.details)));
  if (input.calendar) {
    parts.push(
      section(
        `<div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;color:${MUTED};font-family:${FONT}">Add to calendar</div>
         ${chip("Google", input.calendar.google)}&nbsp; ${chip("Outlook", input.calendar.outlook)}&nbsp; ${chip("Apple / .ics", input.calendar.ics)}`,
      ),
    );
  }
  if (input.manage && (input.manage.rescheduleUrl || input.manage.cancelUrl || input.manage.bookAgainUrl)) {
    const m = input.manage;
    const actions: string[] = [];
    if (m.rescheduleUrl) actions.push(button("Reschedule", m.rescheduleUrl, brand, "ghost"));
    if (m.bookAgainUrl) actions.push(button("Book another time", m.bookAgainUrl, brand, "primary"));
    if (m.cancelUrl) {
      actions.push(
        `<a class="muted" href="${safeHref(m.cancelUrl)}" style="font-size:14px;font-weight:600;color:${MUTED};text-decoration:underline;font-family:${FONT}">Cancel booking</a>`,
      );
    }
    parts.push(
      section(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef2f4"><tr><td style="padding-top:22px">
           ${m.text ? `<p class="t" style="margin:0 0 12px 0;font-size:15px;color:${BODY};font-family:${FONT}">${esc(m.text)}</p>` : ""}
           ${actions.join("&nbsp;&nbsp; ")}
         </td></tr></table>`,
        "26px 36px 8px 36px",
      ),
    );
  }

  const poweredBy =
    brand.poweredBy && !/sothcare/i.test(brand.orgName)
      ? ` · Powered by <a href="https://book.sothcare.com" style="color:${MUTED}">Sothcare Scheduling</a>`
      : "";
  parts.push(
    section(
      `<p class="muted" style="margin:0;font-size:12.5px;line-height:1.6;color:${MUTED};font-family:${FONT}">${esc(input.footer.why)}${
        input.footer.timezone ? ` Times are shown in <strong>${esc(input.footer.timezone)}</strong>.` : ""
      }${input.footer.replyHint ? ` ${esc(input.footer.replyHint)}` : ""}</p>
       <p class="muted" style="margin:14px 0 0 0;font-size:12px;color:${MUTED};font-family:${FONT}">${esc(brand.orgName)} · <a href="${safeHref(brand.siteUrl)}" style="color:${MUTED}">${esc(brand.siteLabel)}</a>${poweredBy}</p>`,
      "26px 36px 30px 36px",
    ),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(input.headline)}</title>
<style>
  @media (max-width:480px) { .pad { padding-left:20px !important; padding-right:20px !important; } }
  @media (prefers-color-scheme: dark) {
    body, .wrap { background:#0b1215 !important; }
    .card { background:#121b1f !important; }
    .t { color:#e6edf0 !important; } .muted { color:#93a1ab !important; }
    .chip { background:#1a262b !important; border-color:#243138 !important; color:#e6edf0 !important; }
    .ghost { background:#121b1f !important; border-color:#2b3a41 !important; }
    .evt { background:#16222a !important; border-color:#243138 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f2f5f7;-webkit-font-smoothing:antialiased;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(input.preheader)}</div>
<div class="wrap" style="background:#f2f5f7;padding:32px 12px">
  <table role="presentation" class="card" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">
    ${parts.join("\n")}
  </table>
</div>
</body>
</html>`;
}
