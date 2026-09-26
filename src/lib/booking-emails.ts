import type { Booking, BookingQuestion, EventType, Host, Organization, WorkflowTrigger } from "@prisma/client";
import { DateTime } from "luxon";
import { APP_URL, publicUrl } from "./env";
import { describeLocation, firstName } from "./templates";
import {
  renderEmailLayout,
  type EmailBrand,
  type EmailDetail,
  type EmailEventCard,
  type EmailLocation,
  type EmailNote,
  type EmailPerson,
  type EmailStatus,
} from "./email-layout";

/**
 * Turns a booking into the HTML for each notification we send. The plain-text
 * body still comes from the (host-editable) templates in templates.ts; this
 * module only produces the rich alternative, so text-only clients and the
 * NotificationLog audit trail are unchanged.
 */

export type BookingForEmail = Booking & {
  eventType: EventType & { questions?: BookingQuestion[] };
  host: Host & { organization: Organization };
  rescheduledFrom?: Booking | null;
};

export type InviteeEmailKind = "confirmation" | "reschedule" | "cancellation";

const STATUS: Record<string, EmailStatus> = {
  confirmed: { label: "Confirmed", tone: "green" },
  pending: { label: "Pending", tone: "amber" },
  rescheduled: { label: "Rescheduled", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "red" },
  reminder: { label: "Reminder", tone: "blue" },
  followUp: { label: "Follow-up", tone: "slate" },
  newBooking: { label: "New booking", tone: "blue" },
  update: { label: "Update", tone: "slate" },
};

// Single implementation lives in templates.ts (see the note there on why the
// dependency runs that way -- booking-emails already imports templates, so
// the reverse would be a cycle). Re-exported so existing callers and tests
// keep importing it from here.
export { firstName };

function normalizeOrgish(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|co|corp|corporation|company|limited)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** True when the host account is named after the company rather than a person. */
export function hostIsOrganization(host: { name: string; organization: { name: string } }): boolean {
  return normalizeOrgish(host.name) === normalizeOrgish(host.organization.name);
}

export function brandFor(host: BookingForEmail["host"]): EmailBrand {
  let siteLabel = "book.sothcare.com";
  try {
    siteLabel = new URL(APP_URL()).host;
  } catch {
    /* keep default */
  }
  return {
    orgName: host.organization.name,
    logoUrl: host.logoUrl,
    brandColor: host.brandColor,
    accentTextOn: host.accentTextOn,
    siteUrl: publicUrl(`/book/${host.slug}`),
    siteLabel,
    poweredBy: host.showPoweredBy,
  };
}

function platformName(locationType: string): string | null {
  switch (locationType) {
    case "ZOOM":
      return "Zoom";
    case "GOOGLE_MEET":
      return "Google Meet";
    case "MICROSOFT_TEAMS":
      return "Microsoft Teams";
    default:
      return null;
  }
}

export function locationRow(booking: BookingForEmail, forHost = false): EmailLocation | null {
  const detail = booking.locationDetail?.trim() || null;
  const videoSub = booking.meetingUrl
    ? "The join link is in the button below and in your calendar invite."
    : "The join link will be sent before the meeting.";
  switch (booking.locationType) {
    case "ZOOM":
      return { label: "Zoom video call", sublabel: videoSub, glyph: "Z", glyphBg: "#E8F0FE", glyphFg: "#1A56DB" };
    case "GOOGLE_MEET":
      return { label: "Google Meet video call", sublabel: videoSub, glyph: "M", glyphBg: "#E6F4EA", glyphFg: "#137333" };
    case "MICROSOFT_TEAMS":
      return { label: "Microsoft Teams call", sublabel: videoSub, glyph: "T", glyphBg: "#EDE9FE", glyphFg: "#5B21B6" };
    case "PHONE_HOST_CALLS":
      return {
        label: "Phone call",
        sublabel: booking.inviteePhone
          ? forHost
            ? `Call the invitee at ${booking.inviteePhone}`
            : `We'll call you at ${booking.inviteePhone}`
          : forHost
            ? "You call the invitee"
            : "We'll call you",
        glyph: "☎",
        glyphBg: "#FEF3C7",
        glyphFg: "#92400E",
      };
    case "PHONE_INVITEE_CALLS":
      return {
        label: "Phone call",
        sublabel: detail ? (forHost ? `The invitee calls ${detail}` : `Call ${detail} at the start time`) : null,
        glyph: "☎",
        glyphBg: "#FEF3C7",
        glyphFg: "#92400E",
      };
    case "IN_PERSON":
      return { label: "In person", sublabel: detail, glyph: "⌖", glyphBg: "#FEE2E2", glyphFg: "#991B1B" };
    default:
      return detail ? { label: detail, sublabel: null, glyph: "•", glyphBg: "#E2E8F0", glyphFg: "#334155" } : null;
  }
}

function hostRow(host: BookingForEmail["host"]): EmailPerson | null {
  // A host account named after the company ("SOTHCARE LLC") would render as a
  // person called SOTHCARE LLC with the initials "SL"; the logo already says
  // who the email is from, so skip the row until a real name is set.
  if (hostIsOrganization(host)) return null;
  const sameName = normalizeOrgish(host.name) === normalizeOrgish(host.organization.name);
  return {
    name: host.name,
    subline: sameName ? "your host" : `${host.organization.name} · your host`,
    avatarUrl: host.avatarUrl,
  };
}

function inviteeRow(booking: BookingForEmail): EmailPerson {
  return { name: booking.inviteeName, subline: booking.inviteeEmail, avatarUrl: null };
}

function utcStamp(date: Date): string {
  return DateTime.fromJSDate(date).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
}

export function calendarLinks(booking: BookingForEmail): { google: string; outlook: string; ics: string } {
  const title = `${booking.eventType.title} — ${booking.host.organization.name}`;
  const details = `${booking.eventType.title} with ${booking.host.organization.name}.\nManage this booking: ${publicUrl(`/booking/${booking.uid}`)}`;
  const location = booking.meetingUrl ?? describeLocation(booking);
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", title);
  google.searchParams.set("dates", `${utcStamp(booking.startsAt)}/${utcStamp(booking.endsAt)}`);
  google.searchParams.set("details", details);
  if (location) google.searchParams.set("location", location);

  const outlook = new URL("https://outlook.office.com/calendar/0/action/compose");
  outlook.searchParams.set("path", "/calendar/action/compose");
  outlook.searchParams.set("rru", "addevent");
  outlook.searchParams.set("subject", title);
  outlook.searchParams.set("startdt", booking.startsAt.toISOString());
  outlook.searchParams.set("enddt", booking.endsAt.toISOString());
  outlook.searchParams.set("body", details);
  if (location) outlook.searchParams.set("location", location);

  return { google: google.toString(), outlook: outlook.toString(), ics: publicUrl(`/api/bookings/${booking.uid}/ics`) };
}

function joinCta(booking: BookingForEmail): { label: string; url: string } | null {
  if (booking.meetingUrl) {
    const platform = platformName(booking.locationType);
    return { label: platform ? `Join ${platform} meeting` : "Join meeting", url: booking.meetingUrl };
  }
  return { label: "View booking", url: publicUrl(`/booking/${booking.uid}`) };
}

function noteFor(booking: BookingForEmail): EmailNote | null {
  const text = booking.eventType.emailNote?.trim() ?? "";
  const highlight = booking.eventType.emailHighlight?.trim() || null;
  if (!text && !highlight) return null;
  return {
    heading: `A note from ${booking.host.organization.name}`,
    paragraphs: text ? text.split(/\n\s*\n/).map((p) => p.trim()) : [],
    highlight,
  };
}

function card(booking: BookingForEmail, opts: { forHost?: boolean; cancelled?: boolean; withCta?: boolean; previous?: Date | null }): EmailEventCard {
  const timezone = opts.forHost ? booking.host.timezone : booking.inviteeTimezone;
  return {
    title: booking.eventType.title,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    timezone,
    durationMinutes: booking.eventType.durationMinutes,
    previousStartsAt: opts.previous ?? null,
    person: opts.forHost ? inviteeRow(booking) : hostRow(booking.host),
    location: locationRow(booking, opts.forHost),
    cancelled: opts.cancelled ?? false,
    cta: opts.withCta === false || opts.cancelled ? null : opts.forHost ? { label: "Open dashboard", url: publicUrl("/dashboard") } : joinCta(booking),
  };
}

function when(booking: BookingForEmail, timezone: string): { date: string; time: string; zone: string } {
  const start = DateTime.fromJSDate(booking.startsAt).setZone(timezone);
  return { date: start.toFormat("cccc, LLLL d"), time: start.toFormat("h:mm a"), zone: start.toFormat("ZZZZ") };
}

const MANAGE_TEXT = "Need a different time? You can change it yourself, no email back-and-forth.";

export function inviteeEmailHtml(booking: BookingForEmail, kind: InviteeEmailKind): string {
  const brand = brandFor(booking.host);
  const org = booking.host.organization.name;
  const first = firstName(booking.inviteeName);
  const title = booking.eventType.title;
  const w = when(booking, booking.inviteeTimezone);
  const rescheduleUrl = publicUrl(`/booking/${booking.uid}/reschedule`);
  const cancelUrl = publicUrl(`/booking/${booking.uid}/cancel`);
  const footer = {
    why: `You're getting this because you booked a meeting with ${org}.`,
    timezone: booking.inviteeTimezone,
    replyHint: "Questions? Just reply to this email.",
  };

  if (kind === "cancellation") {
    const reason = booking.cancelReason?.trim();
    return renderEmailLayout({
      brand,
      preheader: `${title} on ${w.date} at ${w.time} ${w.zone} has been cancelled.`,
      status: STATUS.cancelled!,
      headline: "Your meeting was cancelled",
      intro: [
        `Hi ${first}, your ${title} on ${w.date} at ${w.time} ${w.zone} has been cancelled.${reason ? ` Reason given: ${reason}` : ""}`,
        "You can book another time whenever you're ready.",
      ],
      card: card(booking, { cancelled: true }),
      manage: { bookAgainUrl: publicUrl(`/book/${booking.host.slug}/${booking.eventType.slug}`) },
      footer,
    });
  }

  if (kind === "reschedule") {
    return renderEmailLayout({
      brand,
      preheader: `${title} now starts ${w.date} at ${w.time} ${w.zone}.`,
      status: STATUS.rescheduled!,
      headline: "Your meeting has a new time",
      intro: [`Hi ${first}, your ${title} has been moved. Here are the updated details. Nothing else to do unless you need a different time.`],
      card: card(booking, { previous: booking.rescheduledFrom?.startsAt ?? null }),
      note: noteFor(booking),
      calendar: calendarLinks(booking),
      manage: { text: MANAGE_TEXT, rescheduleUrl, cancelUrl },
      footer,
    });
  }

  if (booking.status === "PENDING") {
    return renderEmailLayout({
      brand,
      preheader: `${org} will confirm your ${title} for ${w.date} at ${w.time} ${w.zone} shortly.`,
      status: STATUS.pending!,
      headline: "We got your request",
      intro: [`Hi ${first}, ${org} will confirm your ${title} shortly. You'll get another email as soon as it's locked in.`],
      card: card(booking, { withCta: false }),
      note: noteFor(booking),
      manage: { cancelUrl },
      footer,
    });
  }

  return renderEmailLayout({
    brand,
    preheader: `${title} on ${w.date} at ${w.time} ${w.zone}. Calendar invite attached.`,
    status: STATUS.confirmed!,
    headline: "You're booked",
    intro: [`Hi ${first}, your ${title} with ${org} is confirmed. Everything you need is below, and a calendar invite is attached.`],
    card: card(booking, {}),
    note: noteFor(booking),
    calendar: calendarLinks(booking),
    manage: { text: MANAGE_TEXT, rescheduleUrl, cancelUrl },
    footer,
  });
}

function answerDetails(booking: BookingForEmail): EmailDetail[] {
  const answers = (booking.answers ?? {}) as Record<string, unknown>;
  const labels = new Map((booking.eventType.questions ?? []).map((q) => [q.id, q.label] as const));
  return Object.entries(answers).map(([id, value]) => ({
    label: labels.get(id) ?? "Answer",
    value: Array.isArray(value) ? value.map(String).join(", ") : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? ""),
  }));
}

export function hostCopyEmailHtml(booking: BookingForEmail): string {
  const brand = brandFor(booking.host);
  const w = when(booking, booking.host.timezone);
  const details: EmailDetail[] = [
    { label: "Email", value: booking.inviteeEmail },
    { label: "Phone", value: booking.inviteePhone ?? "" },
    { label: "Guests", value: booking.guestEmails.join(", ") },
    { label: "Notes", value: booking.inviteeNotes ?? "" },
    ...answerDetails(booking),
  ];
  return renderEmailLayout({
    brand,
    preheader: `${booking.inviteeName} booked ${booking.eventType.title} for ${w.date} at ${w.time} ${w.zone}.`,
    status: booking.status === "PENDING" ? STATUS.pending! : STATUS.newBooking!,
    headline: `${booking.inviteeName} booked ${booking.eventType.title}`,
    intro: [
      booking.status === "PENDING"
        ? `This request is waiting for your confirmation. ${booking.inviteeName} (${booking.inviteeEmail}) asked for ${w.date} at ${w.time} ${w.zone}.`
        : `${booking.inviteeName} (${booking.inviteeEmail}) booked a ${booking.eventType.durationMinutes}-minute ${booking.eventType.title}.`,
    ],
    card: card(booking, { forHost: true }),
    details,
    footer: {
      why: `You're getting this because ${booking.inviteeName} booked time on your ${booking.host.organization.name} scheduling page.`,
      timezone: booking.host.timezone,
      replyHint: `Reply to this email to reach ${firstName(booking.inviteeName)} directly.`,
    },
  });
}

/**
 * Workflow steps carry host-edited subject/body templates. The body may still
 * spell out "When: …", "Where: …" and raw reschedule/cancel URLs from the
 * plain-text era; the card and buttons now show those, so such lines are
 * dropped from the rich version rather than shown twice.
 */
export function stripStructuredLines(body: string): string[] {
  const dropped = /^(when|where|new time|duration|notes?|details?|reschedule( again)?|cancel|join|location)\s*:/i;
  const urlOnly = /^(https?:\/\/\S+)(\s*[·•|-]\s*(reschedule|cancel)\s*:\s*https?:\/\/\S+)*\s*$/i;
  const rescheduleCancel = /^(reschedule( again)?|cancel)\s*:\s*https?:\/\/\S+(\s*[·•|-]\s*(cancel|reschedule)\s*:\s*https?:\/\/\S+)?\s*$/i;
  const kept = body
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      return !dropped.test(t) && !urlOnly.test(t) && !rescheduleCancel.test(t);
    })
    .join("\n");
  return kept
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function workflowEmailHtml(
  booking: BookingForEmail,
  opts: { trigger: WorkflowTrigger; toHost: boolean; subject: string; body: string },
): string {
  const brand = brandFor(booking.host);
  const org = booking.host.organization.name;
  const cancelled = opts.trigger === "BOOKING_CANCELLED" || booking.status === "CANCELLED";
  const status =
    opts.trigger === "BEFORE_EVENT"
      ? STATUS.reminder!
      : opts.trigger === "AFTER_EVENT"
        ? STATUS.followUp!
        : opts.trigger === "BOOKING_CANCELLED"
          ? STATUS.cancelled!
          : opts.trigger === "BOOKING_RESCHEDULED"
            ? STATUS.rescheduled!
            : opts.toHost
              ? STATUS.newBooking!
              : STATUS.confirmed!;

  let intro = stripStructuredLines(opts.body);
  // Drop a bare sign-off that just repeats the host/org name.
  const last = intro[intro.length - 1];
  if (last && normalizeOrgish(last) === normalizeOrgish(booking.host.name)) intro = intro.slice(0, -1);
  if (intro.length === 0) intro = [opts.subject];

  const timezone = opts.toHost ? booking.host.timezone : booking.inviteeTimezone;
  const showManage = !opts.toHost && !cancelled && opts.trigger !== "AFTER_EVENT";
  return renderEmailLayout({
    brand,
    preheader: opts.subject,
    status,
    headline: opts.subject,
    intro,
    card: card(booking, { forHost: opts.toHost, cancelled, withCta: !cancelled && opts.trigger !== "AFTER_EVENT" }),
    note: !opts.toHost && !cancelled && opts.trigger !== "AFTER_EVENT" ? noteFor(booking) : null,
    calendar: showManage ? calendarLinks(booking) : null,
    manage: showManage
      ? { text: MANAGE_TEXT, rescheduleUrl: publicUrl(`/booking/${booking.uid}/reschedule`), cancelUrl: publicUrl(`/booking/${booking.uid}/cancel`) }
      : cancelled && !opts.toHost
        ? { bookAgainUrl: publicUrl(`/book/${booking.host.slug}/${booking.eventType.slug}`) }
        : null,
    footer: {
      why: opts.toHost
        ? `You're getting this because of a booking on your ${org} scheduling page.`
        : `You're getting this because you booked a meeting with ${org}.`,
      timezone,
      replyHint: opts.toHost ? null : "Questions? Just reply to this email.",
    },
  });
}
