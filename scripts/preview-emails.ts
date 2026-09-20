/**
 * Renders every email the module sends, with sample data, into
 * .email-previews/*.html so the design can be checked in a browser without
 * sending anything. Run: npm run email:preview
 *
 * The logo is inlined as a data URI here only, because browsers refuse to
 * load remote images inside a file:// page; real emails reference Host.logoUrl.
 */
import fs from "node:fs";
import path from "node:path";
import { hostCopyEmailHtml, inviteeEmailHtml, workflowEmailHtml, type BookingForEmail } from "../src/lib/booking-emails";

process.env.APP_URL = process.env.APP_URL || "https://book.sothcare.com";

const logoPath = path.join(process.cwd(), "public", "brand", "sothcare-logo.png");
const logoUrl = fs.existsSync(logoPath)
  ? `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`
  : "https://book.sothcare.com/brand/sothcare-logo.png";

const startsAt = new Date("2026-09-21T15:30:00.000Z");
const endsAt = new Date("2026-09-21T15:50:00.000Z");
const now = new Date();

const booking = {
  id: "b1",
  uid: "hxAWzLkzYxDnQFsEigwaSw",
  organizationId: "o1",
  hostId: "h1",
  eventTypeId: "e1",
  startsAt,
  endsAt,
  timezone: "America/New_York",
  status: "CONFIRMED",
  attendanceStatus: "UNKNOWN",
  inviteeName: "hayl abdulle",
  inviteeEmail: "salmaanc@gmail.com",
  inviteePhone: "+1 612 555 0142",
  inviteeTimezone: "America/New_York",
  inviteeNotes: "We run two 245D homes in Robbinsdale and want to see medication passes.",
  guestEmails: ["ops@example.com"],
  answers: { q1: "245D" },
  locationType: "ZOOM",
  locationDetail: null,
  meetingUrl: "https://us05web.zoom.us/j/9984714236?pwd=z7b2RCgZmgDZF2aEbrDKO2PvGXQMy2.1",
  externalEventId: null,
  externalCalendarId: null,
  cancelledAt: null,
  cancelReason: null,
  cancelledBy: null,
  rescheduledFromId: null,
  createdAt: now,
  updatedAt: now,
  eventType: {
    id: "e1",
    hostId: "h1",
    scheduleId: null,
    slug: "20-min-demo",
    title: "Sothcare 20-Min Demo",
    description: null,
    color: "#1B8A6C",
    durationMinutes: 20,
    slotIntervalMinutes: 15,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 240,
    rollingDays: 60,
    maxBookingsPerDay: null,
    seatsPerSlot: 1,
    locationType: "ZOOM",
    locationValue: "https://us05web.zoom.us/j/9984714236?pwd=z7b2RCgZmgDZF2aEbrDKO2PvGXQMy2.1",
    requiresConfirmation: false,
    redirectUrl: null,
    isActive: true,
    isHidden: false,
    emailNote:
      "Thanks for booking time with Sothcare. We look forward to sharing the platform with you. If anything changes with your schedule please let us know beforehand so we can find another time that works for you.",
    emailHighlight: "Please bring a laptop or iPad so you can follow along clearly.",
    createdAt: now,
    updatedAt: now,
    questions: [
      { id: "q1", eventTypeId: "e1", label: "Which license type do you operate under?", helpText: null, type: "SELECT", required: true, options: ["245D", "144G"], position: 0 },
    ],
  },
  host: {
    id: "h1",
    organizationId: "o1",
    externalUserId: null,
    passwordHash: null,
    name: "SOTHCARE LLC",
    email: "admin@sothcare.com",
    slug: "salmaan",
    timezone: "America/Chicago",
    headline: null,
    welcomeText: null,
    avatarUrl: null,
    logoUrl,
    brandColor: "#1B8A6C",
    accentTextOn: "#FFFFFF",
    pageBackground: "#F6F7F9",
    customCss: null,
    showPoweredBy: true,
    inviteAttendeesOnCalendar: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    organization: { id: "o1", name: "Sothcare LLC", slug: "sothcare", createdAt: now, updatedAt: now },
  },
  rescheduledFrom: null,
} as unknown as BookingForEmail;

const outDir = path.join(process.cwd(), ".email-previews");
fs.mkdirSync(outDir, { recursive: true });

const files: Record<string, string> = {
  "01-confirmation.html": inviteeEmailHtml(booking, "confirmation"),
  "02-pending.html": inviteeEmailHtml({ ...booking, status: "PENDING" } as BookingForEmail, "confirmation"),
  "03-reschedule.html": inviteeEmailHtml(
    { ...booking, rescheduledFrom: { ...booking, startsAt: new Date("2026-09-21T14:00:00.000Z") } } as BookingForEmail,
    "reschedule",
  ),
  "04-cancellation.html": inviteeEmailHtml(
    { ...booking, status: "CANCELLED", cancelReason: "Schedule conflict" } as BookingForEmail,
    "cancellation",
  ),
  "05-host-copy.html": hostCopyEmailHtml(booking),
  "06-reminder-24h.html": workflowEmailHtml(booking, {
    trigger: "BEFORE_EVENT",
    toHost: false,
    subject: "Tomorrow: Sothcare 20-Min Demo with Sothcare",
    body: "Hi Hayl,\n\nA reminder that your Sothcare 20-Min Demo is tomorrow.\n\nWhen: Monday, September 21, 2026 at 11:30 AM EDT\nWhere: Zoom — https://us05web.zoom.us/j/9984714236\n\nReschedule: https://book.sothcare.com/r · Cancel: https://book.sothcare.com/c\n\nSOTHCARE LLC",
  }),
  "07-follow-up.html": workflowEmailHtml(booking, {
    trigger: "AFTER_EVENT",
    toHost: false,
    subject: "Thanks for your time, Hayl",
    body: "Hi Hayl,\n\nThanks for taking the time to see Sothcare today. If you'd like a trial workspace for your agency, just reply to this email and we'll set it up.\n\nSOTHCARE LLC",
  }),
  "08-google-meet-in-person.html": inviteeEmailHtml(
    {
      ...booking,
      eventType: { ...booking.eventType, title: "Caregiver orientation (group)", durationMinutes: 60, locationType: "IN_PERSON", emailNote: null, emailHighlight: null },
      endsAt: new Date("2026-09-21T16:30:00.000Z"),
      locationType: "IN_PERSON",
      locationDetail: "Sothcare office, 1200 Main St, Robbinsdale MN",
      meetingUrl: null,
      host: { ...booking.host, name: "Salmaan Abdullahi" },
    } as BookingForEmail,
    "confirmation",
  ),
};

for (const [name, html] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), html);
}
const index = `<!doctype html><meta charset="utf-8"><title>Email previews</title>
<body style="font-family:system-ui;padding:24px"><h1>Email previews</h1><ul>${Object.keys(files)
  .map((f) => `<li><a href="./${f}">${f}</a></li>`)
  .join("")}</ul></body>`;
fs.writeFileSync(path.join(outDir, "index.html"), index);
console.log(`wrote ${Object.keys(files).length} previews to ${outDir}`);
