import { DateTime } from "luxon";
import type { Booking, EventType, Host } from "@prisma/client";
import { publicUrl } from "./env";

/**
 * Template variables available in every workflow email. Deliberately a flat
 * string map with `{{snake_case}}` placeholders — non-technical staff edit
 * these in the dashboard, so anything more clever is a support burden.
 */
export type TemplateVars = Record<string, string>;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key: string) => vars[key] ?? "");
}

export const TEMPLATE_VARIABLES = [
  "invitee_name",
  "invitee_email",
  "invitee_phone",
  "host_name",
  "host_email",
  "event_title",
  "event_duration",
  "event_date",
  "event_time",
  "event_datetime",
  "event_timezone",
  "location",
  "meeting_url",
  "invitee_notes",
  "reschedule_url",
  "cancel_url",
  "booking_url",
] as const;

export function bookingVars(
  booking: Booking,
  eventType: EventType,
  host: Host,
  /** Render times in the invitee's timezone — they are the reader. */
  timezone = booking.inviteeTimezone,
): TemplateVars {
  const start = DateTime.fromJSDate(booking.startsAt).setZone(timezone);
  return {
    invitee_name: booking.inviteeName,
    invitee_email: booking.inviteeEmail,
    invitee_phone: booking.inviteePhone ?? "",
    host_name: host.name,
    host_email: host.email,
    event_title: eventType.title,
    event_duration: `${eventType.durationMinutes} minutes`,
    event_date: start.toFormat("cccc, LLLL d, yyyy"),
    event_time: start.toFormat("h:mm a ZZZZ"),
    event_datetime: start.toFormat("cccc, LLLL d, yyyy 'at' h:mm a ZZZZ"),
    event_timezone: timezone,
    location: describeLocation(booking),
    meeting_url: booking.meetingUrl ?? "",
    invitee_notes: booking.inviteeNotes ?? "",
    reschedule_url: publicUrl(`/booking/${booking.uid}/reschedule`),
    cancel_url: publicUrl(`/booking/${booking.uid}/cancel`),
    booking_url: publicUrl(`/booking/${booking.uid}`),
  };
}

export function describeLocation(booking: {
  locationType: string;
  locationDetail: string | null;
  meetingUrl: string | null;
  inviteePhone?: string | null;
}): string {
  switch (booking.locationType) {
    case "GOOGLE_MEET":
      return booking.meetingUrl ? `Google Meet — ${booking.meetingUrl}` : "Google Meet (link to follow)";
    case "ZOOM":
      return booking.meetingUrl ? `Zoom — ${booking.meetingUrl}` : "Zoom (link to follow)";
    case "MICROSOFT_TEAMS":
      return booking.meetingUrl ? `Microsoft Teams — ${booking.meetingUrl}` : "Microsoft Teams (link to follow)";
    case "PHONE_HOST_CALLS":
      return booking.inviteePhone ? `We will call you at ${booking.inviteePhone}` : "Phone call";
    case "PHONE_INVITEE_CALLS":
      return booking.locationDetail ? `Call ${booking.locationDetail}` : "Phone call";
    case "IN_PERSON":
      return booking.locationDetail ?? "In person";
    default:
      return booking.locationDetail ?? "";
  }
}

/** Seeded on every new host so a fresh account already notifies properly. */
export const DEFAULT_TEMPLATES = {
  confirmationToInvitee: {
    subject: "Confirmed: {{event_title}} with {{host_name}}",
    body: `Hi {{invitee_name}},

Your {{event_title}} is confirmed.

When: {{event_datetime}}
Duration: {{event_duration}}
Where: {{location}}

Need to change it? Reschedule: {{reschedule_url}}
Cancel: {{cancel_url}}

See you then,
{{host_name}}`,
  },
  confirmationToHost: {
    subject: "New booking: {{event_title}} — {{invitee_name}}",
    body: `{{invitee_name}} ({{invitee_email}}) booked {{event_title}}.

When: {{event_datetime}}
Where: {{location}}
Notes: {{invitee_notes}}

Details: {{booking_url}}`,
  },
  reminder24h: {
    subject: "Tomorrow: {{event_title}} with {{host_name}}",
    body: `Hi {{invitee_name}},

A reminder that your {{event_title}} is tomorrow.

When: {{event_datetime}}
Where: {{location}}

Reschedule: {{reschedule_url}} · Cancel: {{cancel_url}}

{{host_name}}`,
  },
  reminder1h: {
    subject: "Starting soon: {{event_title}}",
    body: `Hi {{invitee_name}},

Your {{event_title}} starts in about an hour.

When: {{event_time}}
Where: {{location}}

{{host_name}}`,
  },
  cancellation: {
    subject: "Cancelled: {{event_title}} on {{event_date}}",
    body: `Hi {{invitee_name}},

Your {{event_title}} on {{event_datetime}} has been cancelled.

You can book another time whenever you're ready.

{{host_name}}`,
  },
  reschedule: {
    subject: "Updated: {{event_title}} moved to {{event_date}}",
    body: `Hi {{invitee_name}},

Your {{event_title}} has been moved.

New time: {{event_datetime}}
Where: {{location}}

Reschedule again: {{reschedule_url}} · Cancel: {{cancel_url}}

{{host_name}}`,
  },
  followUp: {
    subject: "Thanks for your time, {{invitee_name}}",
    body: `Hi {{invitee_name}},

Thanks for joining the {{event_title}} today. If anything came up afterwards, just reply to this email.

{{host_name}}`,
  },
};
