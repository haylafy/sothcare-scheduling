/**
 * Demo follow-up emails.
 *
 * One hour after the host marks a booking Attended or No-show, the prospect
 * gets the matching note. Built on the existing workflow engine rather than a
 * second scheduler: WorkflowRun already gives one row per (workflow, booking),
 * a claim-before-send that survives overlapping cron ticks, and a
 * NotificationLog entry per send.
 *
 * The copy below is the seed for two Workflow rows, so it can be reworded in
 * /dashboard/workflows without a deploy. Editing it HERE only affects hosts
 * that have not been seeded yet -- the seed upserts by (hostId, name) and
 * deliberately does not overwrite an existing body.
 */

/**
 * Bookings that start before this are never followed up.
 *
 * The feature went in after these meetings were booked; sending a "thanks for
 * joining" to someone whose demo happened weeks ago reads as a mistake, and a
 * host marking up an old backlog would blast all of them at once. A constant
 * rather than an env var on purpose: an unset env var would silently mean "no
 * cutoff", which is the failure that actually hurts.
 */
export const DEMO_FOLLOWUP_MIN_START = new Date("2026-09-28T00:00:00.000Z");

/** Minutes after the host marks attendance before the follow-up goes out. */
export const DEMO_FOLLOWUP_OFFSET_MINUTES = 60;

export function isEligibleForDemoFollowUp(startsAt: Date): boolean {
  return startsAt.getTime() >= DEMO_FOLLOWUP_MIN_START.getTime();
}

export const FOLLOW_UP_ATTENDED = {
  name: "Demo follow-up — attended",
  subject: "Thanks for joining the Sothcare demo",
  preview: "Your demo recap, replay link, and next steps",
  body: `Hi {{invitee_first_name}},

Thank you for taking the time to join the Sothcare demo. It was great learning more about your agency and showing you how Sothcare can help your team run more smoothly.

If you'd like to share it with your team or revisit any part, you can also rewatch our 12-minute Sothcare software demo at your convenience here:
https://sothcare.com/watch-demo

Have questions, or ready to talk next steps? Just reply to this email and we'll get right back to you.

Thanks,
The Sothcare Team`,
} as const;

export const FOLLOW_UP_NO_SHOW = {
  name: "Demo follow-up — no-show",
  // A hyphen, not an em dash: the subject line is the one string that lands in
  // a list view in every mail client, and the source spec wrote it this way.
  subject: "Sorry we missed you - here's the Sothcare demo",
  preview: "Watch the 12-minute demo anytime, or pick a new time to meet",
  body: `Hi {{invitee_first_name}},

We're sorry we missed you at your scheduled Sothcare demo. We know things come up, especially when you're running a busy agency.

In the meantime, you can rewatch our 12-minute Sothcare software demo at your convenience here:
https://sothcare.com/watch-demo

We'd still love to walk you through it live and answer your questions. Just reply to this email with a couple of times that work for you, and we'll get you rescheduled.

Book a new time: {{book_new_url}}

Thanks,
The Sothcare Team`,
} as const;

export const DEMO_FOLLOW_UPS = [
  { ...FOLLOW_UP_ATTENDED, condition: "ATTENDED_ONLY" as const },
  { ...FOLLOW_UP_NO_SHOW, condition: "NO_SHOW_ONLY" as const },
];
