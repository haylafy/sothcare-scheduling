import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstName,
  hostCopyEmailHtml,
  hostIsOrganization,
  inviteeEmailHtml,
  stripStructuredLines,
  workflowEmailHtml,
  type BookingForEmail,
} from "../src/lib/booking-emails";
import { formatTimeRange, formatDuration, initials } from "../src/lib/email-layout";

process.env.APP_URL = "https://book.example.test";

function sampleBooking(overrides: Partial<BookingForEmail> = {}): BookingForEmail {
  const startsAt = new Date("2026-09-21T15:30:00.000Z"); // 11:30 AM EDT
  const endsAt = new Date("2026-09-21T15:50:00.000Z");
  const base = {
    id: "b1",
    uid: "abc123",
    organizationId: "o1",
    hostId: "h1",
    eventTypeId: "e1",
    startsAt,
    endsAt,
    timezone: "America/New_York",
    status: "CONFIRMED",
    attendanceStatus: "UNKNOWN",
    inviteeName: "hayl <script>alert(1)</script>",
    inviteeEmail: "hayl@example.com",
    inviteePhone: null,
    inviteeTimezone: "America/New_York",
    inviteeNotes: "Looking at 245D",
    guestEmails: [],
    answers: { q1: "245D" },
    locationType: "ZOOM",
    locationDetail: null,
    meetingUrl: "https://us05web.zoom.us/j/123?pwd=abc",
    externalEventId: null,
    externalCalendarId: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledBy: null,
    rescheduledFromId: null,
    createdAt: startsAt,
    updatedAt: startsAt,
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
      minimumNoticeMinutes: 0,
      rollingDays: 60,
      maxBookingsPerDay: null,
      seatsPerSlot: 1,
      locationType: "ZOOM",
      locationValue: "https://us05web.zoom.us/j/123?pwd=abc",
      requiresConfirmation: false,
      redirectUrl: null,
      isActive: true,
      isHidden: false,
      emailNote: "Thanks for booking time with Sothcare.\n\nIf anything changes, let us know beforehand.",
      emailHighlight: "Please bring a laptop or iPad so you can follow along clearly.",
      createdAt: startsAt,
      updatedAt: startsAt,
      questions: [
        {
          id: "q1",
          eventTypeId: "e1",
          label: "Which license type?",
          helpText: null,
          type: "SELECT",
          required: true,
          options: ["245D", "144G"],
          position: 0,
        },
      ],
    },
    host: {
      id: "h1",
      organizationId: "o1",
      externalUserId: null,
      passwordHash: null,
      name: "Salmaan Abdullahi",
      email: "admin@example.com",
      slug: "salmaan",
      timezone: "America/Chicago",
      headline: null,
      welcomeText: null,
      avatarUrl: null,
      logoUrl: "https://book.example.test/brand/logo.png",
      brandColor: "#1B8A6C",
      accentTextOn: "#FFFFFF",
      pageBackground: "#F6F7F9",
      customCss: null,
      showPoweredBy: true,
      inviteAttendeesOnCalendar: false,
      isActive: true,
      createdAt: startsAt,
      updatedAt: startsAt,
      organization: { id: "o1", name: "Sothcare LLC", slug: "sothcare", createdAt: startsAt, updatedAt: startsAt },
    },
    rescheduledFrom: null,
  };
  return { ...base, ...overrides } as unknown as BookingForEmail;
}

test("helpers: first name, initials, duration, time range", () => {
  assert.equal(firstName("hayl"), "Hayl");
  assert.equal(firstName("  "), "there");
  assert.equal(firstName("mary ann smith"), "Mary");
  assert.equal(initials("Salmaan Abdullahi"), "SA");
  assert.equal(formatDuration(20), "20 min");
  assert.equal(formatDuration(60), "1 hr");
  assert.equal(formatDuration(90), "1 hr 30 min");
  assert.equal(
    formatTimeRange(new Date("2026-09-21T15:30:00Z"), new Date("2026-09-21T15:50:00Z"), "America/New_York"),
    "11:30 – 11:50 AM",
  );
  assert.equal(
    formatTimeRange(new Date("2026-09-21T15:30:00Z"), new Date("2026-09-21T16:30:00Z"), "America/New_York"),
    "11:30 AM – 12:30 PM",
  );
});

test("confirmation: brand, escaped name, join button, note, calendar chips, manage links", () => {
  const html = inviteeEmailHtml(sampleBooking(), "confirmation");
  assert.match(html, /You&#39;re booked/);
  assert.match(html, /Hi Hayl/);
  assert.doesNotMatch(html, /<script>/, "invitee-supplied HTML must never reach the markup");
  assert.match(html, /Join Zoom meeting/);
  assert.match(html, /https:\/\/us05web\.zoom\.us\/j\/123\?pwd=abc/);
  assert.match(html, /A note from Sothcare LLC/);
  assert.match(html, /Please bring a laptop or iPad/);
  assert.match(html, /Add to calendar/);
  assert.match(html, /calendar\.google\.com\/calendar\/render/);
  assert.match(html, /outlook\.office\.com/);
  assert.match(html, /\/api\/bookings\/abc123\/ics/);
  assert.match(html, /\/booking\/abc123\/reschedule/);
  assert.match(html, /\/booking\/abc123\/cancel/);
  assert.match(html, /brand\/logo\.png/);
  assert.match(html, /Salmaan Abdullahi/);
  assert.match(html, /your host/);
  assert.match(html, /EDT · 20 min/);
  assert.match(html, /Times are shown in <strong>America\/New_York<\/strong>/);
  assert.doesNotMatch(html, /Powered by/, "the org is Sothcare itself");
});

test("pending request: no join button or calendar chips, cancel only", () => {
  const html = inviteeEmailHtml(sampleBooking({ status: "PENDING" } as Partial<BookingForEmail>), "confirmation");
  assert.match(html, /We got your request/);
  assert.match(html, /Pending/);
  assert.doesNotMatch(html, /Join Zoom meeting/);
  assert.doesNotMatch(html, /Add to calendar/);
  assert.match(html, /Cancel booking/);
  assert.doesNotMatch(html, />Reschedule</);
});

test("reschedule: shows the previous time struck through", () => {
  const html = inviteeEmailHtml(
    sampleBooking({
      rescheduledFrom: { startsAt: new Date("2026-09-21T14:00:00.000Z") } as unknown as BookingForEmail["rescheduledFrom"],
    }),
    "reschedule",
  );
  assert.match(html, /Rescheduled/);
  assert.match(html, /Your meeting has a new time/);
  assert.match(html, /Previously/);
  assert.match(html, /10:00 AM EDT/);
});

test("cancellation: strikes the time, offers to book again, no reschedule/cancel controls", () => {
  const html = inviteeEmailHtml(
    sampleBooking({ status: "CANCELLED", cancelReason: "conflict" } as Partial<BookingForEmail>),
    "cancellation",
  );
  assert.match(html, /Your meeting was cancelled/);
  assert.match(html, /Reason given: conflict/);
  assert.match(html, /Book another time/);
  assert.match(html, /\/book\/salmaan\/20-min-demo/);
  assert.doesNotMatch(html, /Cancel booking/);
  assert.doesNotMatch(html, /Join Zoom meeting/);
  assert.doesNotMatch(html, /A note from/);
  assert.doesNotMatch(html, /Add to calendar/);
});

test("host copy: invitee details and answers with question labels", () => {
  const html = hostCopyEmailHtml(sampleBooking());
  assert.match(html, /New booking/);
  assert.match(html, /booked Sothcare 20-Min Demo/);
  // The full invitee name is printed here, so this is where escaping is proven.
  assert.doesNotMatch(html, /<script>/, "invitee-supplied HTML must be escaped");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /hayl@example\.com/);
  assert.match(html, /Which license type\?/);
  assert.match(html, /245D/);
  assert.match(html, /Looking at 245D/);
  assert.match(html, /Open dashboard/);
  assert.match(html, /Times are shown in <strong>America\/Chicago<\/strong>/);
});

test("host named after the organisation hides the person row", () => {
  const b = sampleBooking();
  b.host.name = "SOTHCARE LLC";
  assert.equal(hostIsOrganization(b.host), true);
  const html = inviteeEmailHtml(b, "confirmation");
  assert.doesNotMatch(html, /your host/);
  assert.doesNotMatch(html, /SOTHCARE LLC/);
  assert.match(html, /A note from Sothcare LLC/);
});

test("workflow reminder: structured lines from legacy text templates are not repeated", () => {
  const body = `Hi Hayl,

A reminder that your Sothcare 20-Min Demo is tomorrow.

When: Monday, September 21, 2026 at 11:30 AM EDT
Where: Zoom — https://us05web.zoom.us/j/123

Reschedule: https://x/r · Cancel: https://x/c

Salmaan Abdullahi`;
  assert.deepEqual(stripStructuredLines(body), ["Hi Hayl,", "A reminder that your Sothcare 20-Min Demo is tomorrow.", "Salmaan Abdullahi"]);
  const html = workflowEmailHtml(sampleBooking(), {
    trigger: "BEFORE_EVENT",
    toHost: false,
    subject: "Tomorrow: Sothcare 20-Min Demo",
    body,
  });
  assert.match(html, /Reminder/);
  assert.match(html, /A reminder that your Sothcare 20-Min Demo is tomorrow\./);
  assert.doesNotMatch(html, /When:/);
  assert.doesNotMatch(html, /https:\/\/x\/r/);
  assert.match(html, /Join Zoom meeting/);
  assert.match(html, /Add to calendar/);
  // the sign-off that repeats the host name is dropped from the intro
  assert.doesNotMatch(html, /<p[^>]*>Salmaan Abdullahi<\/p>/);
});

test("workflow follow-up and host emails skip the self-service controls", () => {
  const followUp = workflowEmailHtml(sampleBooking(), { trigger: "AFTER_EVENT", toHost: false, subject: "Thanks", body: "Thanks for your time." });
  assert.match(followUp, /Follow-up/);
  assert.doesNotMatch(followUp, /Add to calendar/);
  assert.doesNotMatch(followUp, /Cancel booking/);
  const toHost = workflowEmailHtml(sampleBooking(), { trigger: "BOOKING_CREATED", toHost: true, subject: "New booking", body: "" });
  assert.match(toHost, /Open dashboard/);
  assert.doesNotMatch(toHost, /Cancel booking/);
  assert.match(toHost, /hayl@example\.com/);
});
