import { DateTime } from "luxon";
import type { WorkflowTrigger } from "@prisma/client";
import { fetch as undiciFetch } from "undici";
import { prisma } from "./prisma";
import { bookingVars, describeLocation, renderTemplate } from "./templates";
import { sendMail } from "./mail";
import { buildIcs } from "./ics";
import { publicUrl } from "./env";
import { assertSafeWebhookUrl } from "./url-safety";
import { getActiveHubSpotAccount, logTimelineNote } from "./hubspot";

/**
 * Workflow engine.
 *
 * Immediate triggers (BOOKING_CREATED / CANCELLED / RESCHEDULED) fire inline.
 * Time-based triggers (BEFORE_EVENT / AFTER_EVENT) are materialised as
 * WorkflowRun rows at booking time and picked up by the cron runner, so
 * reminders survive deploys and restarts. The unique (workflowId, bookingId)
 * index keeps one run per booking, and the runner claims a row with a
 * conditional update before sending, so overlapping cron invocations cannot
 * send the same reminder twice.
 */

const IMMEDIATE: WorkflowTrigger[] = ["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED"];

async function workflowsFor(hostId: string, eventTypeId: string, triggers: WorkflowTrigger[]) {
  return prisma.workflow.findMany({
    where: {
      hostId,
      isActive: true,
      trigger: { in: triggers },
      OR: [{ allEventTypes: true }, { eventTypes: { some: { eventTypeId } } }],
    },
    include: { steps: { orderBy: { position: "asc" } } },
  });
}

/** Materialise pending runs for every time-based workflow on this booking. */
export async function scheduleWorkflowRuns(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const workflows = await workflowsFor(booking.hostId, booking.eventTypeId, [
    "BEFORE_EVENT",
    "AFTER_EVENT",
  ]);

  for (const workflow of workflows) {
    const anchor = workflow.trigger === "BEFORE_EVENT" ? booking.startsAt : booking.endsAt;
    const offset = workflow.trigger === "BEFORE_EVENT" ? -workflow.offsetMinutes : workflow.offsetMinutes;
    const scheduledFor = new Date(anchor.getTime() + offset * 60000);

    // A reminder whose moment already passed (same-day booking) is dropped
    // rather than fired late — nobody wants "your meeting is tomorrow" an hour
    // after it ended.
    if (scheduledFor.getTime() <= Date.now()) continue;

    await prisma.workflowRun.upsert({
      where: { workflowId_bookingId: { workflowId: workflow.id, bookingId } },
      update: { scheduledFor, status: "PENDING", lastError: null },
      create: { workflowId: workflow.id, bookingId, scheduledFor },
    });
  }
}

export async function cancelRunsForBooking(bookingId: string) {
  await prisma.workflowRun.updateMany({
    where: { bookingId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}

/** Fire the workflows whose trigger is "right now". */
export async function runWorkflowsNow(bookingId: string, trigger: WorkflowTrigger) {
  if (!IMMEDIATE.includes(trigger)) return;
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const workflows = await workflowsFor(booking.hostId, booking.eventTypeId, [trigger]);
  for (const workflow of workflows) {
    await executeSteps(workflow.id, bookingId);
  }
}

/** Execute one workflow's steps against one booking. */
export async function executeSteps(workflowId: string, bookingId: string) {
  const workflow = await prisma.workflow.findUniqueOrThrow({
    where: { id: workflowId },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { eventType: true, host: true },
  });

  for (const step of workflow.steps) {
    if (step.action === "WEBHOOK") {
      if (!step.webhookUrl) continue;
      // Host-supplied URL fetched by our server: verify it resolves to a
      // public address (not the cloud metadata endpoint or a VPC host) and
      // cap how long it can hold the request open. The returned dispatcher
      // pins the connection to that already-checked address so a DNS-
      // rebinding attacker cannot swap in a private address for the real
      // request (see assertSafeWebhookUrl's doc comment).
      const { url: target, dispatcher } = await assertSafeWebhookUrl(step.webhookUrl);
      // undici's own fetch (not the global one) so `dispatcher` is a typed,
      // supported option rather than an undocumented pass-through property.
      const response = await undiciFetch(target, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json" },
        dispatcher,
        body: JSON.stringify({
          workflow: workflow.name,
          trigger: workflow.trigger,
          booking: {
            uid: booking.uid,
            status: booking.status,
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            eventType: booking.eventType.title,
            invitee: {
              name: booking.inviteeName,
              email: booking.inviteeEmail,
              phone: booking.inviteePhone,
              timezone: booking.inviteeTimezone,
            },
            answers: booking.answers,
            url: publicUrl(`/booking/${booking.uid}`),
          },
        }),
      });
      // fetch only rejects on transport errors, so a 500 from the receiver
      // would otherwise be recorded as a successful delivery.
      if (!response.ok) {
        throw new Error(`Webhook ${target.host} responded ${response.status}`);
      }
      continue;
    }

    if (step.action === "CRM_LOG_NOTE") {
      const account = await getActiveHubSpotAccount(booking.hostId);
      // No connected HubSpot account is a real failure for a step the host
      // explicitly configured (unlike syncToCrm's silent skip on ordinary
      // bookings) -- the run should record this as an error, same as a
      // webhook that times out, rather than quietly doing nothing.
      if (!account) throw new Error("CRM_LOG_NOTE step configured but no HubSpot account is connected");

      const contactId = (
        await prisma.crmSyncRecord.findUnique({ where: { bookingId: booking.id } })
      )?.contactId;
      if (!contactId) throw new Error("No synced HubSpot contact for this booking yet");

      const vars = bookingVars(booking, booking.eventType, booking.host, booking.host.timezone);
      const body = renderTemplate(step.body || `${workflow.name} (via Sothcare Scheduling)`, vars);
      await logTimelineNote(account, contactId, body);
      continue;
    }

    const toHost = step.action === "EMAIL_HOST";
    const recipient =
      step.action === "EMAIL_CUSTOM" ? step.toOverride : toHost ? booking.host.email : booking.inviteeEmail;
    if (!recipient) continue;

    const vars = bookingVars(
      booking,
      booking.eventType,
      booking.host,
      toHost ? booking.host.timezone : booking.inviteeTimezone,
    );

    const attachments = step.includeIcs
      ? [
          {
            filename: "invite.ics",
            contentType: "text/calendar; method=REQUEST; charset=utf-8",
            content: buildIcs({
              uid: `${booking.uid}@sothcare.com`,
              method: "REQUEST" as const,
              summary: `${booking.eventType.title} — ${booking.host.name}`,
              description: describeLocation(booking),
              start: booking.startsAt,
              end: booking.endsAt,
              organizer: { name: booking.host.name, email: booking.host.email },
              attendees: [{ name: booking.inviteeName, email: booking.inviteeEmail }],
            }),
          },
        ]
      : undefined;

    await sendMail({
      to: recipient,
      subject: renderTemplate(step.subject ?? workflow.name, vars),
      text: renderTemplate(step.body ?? "", vars),
      replyTo: toHost ? booking.inviteeEmail : booking.host.email,
      bookingId: booking.id,
      kind: `workflow:${workflow.trigger.toLowerCase()}`,
      attachments,
    });
  }
}

export interface CronResult {
  processed: number;
  sent: number;
  failed: number;
}

/**
 * Process every run that is due. Called by /api/cron/workflows (EventBridge,
 * Vercel Cron, or plain `npm run cron:run`). Safe to call as often as you like;
 * a five-minute cadence keeps reminders punctual enough.
 */
export async function processDueWorkflowRuns(limit = 200): Promise<CronResult> {
  const due = await prisma.workflowRun.findMany({
    where: { status: "PENDING", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    include: {
      booking: { select: { status: true, attendanceStatus: true } },
      workflow: { select: { condition: true } },
    },
  });

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const run of due) {
    // A booking cancelled or moved after the run was scheduled must not be
    // reminded.
    if (run.booking.status === "CANCELLED" || run.booking.status === "RESCHEDULED") {
      await prisma.workflowRun.updateMany({
        where: { id: run.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      continue;
    }

    // Attendance-gated workflows (e.g. a no-show follow-up sequence): the
    // host usually marks attendance shortly after the meeting, which can
    // land before OR after this run's scheduledFor moment. UNKNOWN means
    // "not decided yet" -- leave the run PENDING so the next cron tick
    // re-checks it, rather than either firing prematurely or giving up.
    // Once attendance is marked the OPPOSITE of what this workflow needs,
    // it can never match, so cancel it outright instead of polling forever.
    if (run.workflow.condition !== "ANY") {
      const attendance = run.booking.attendanceStatus;
      const matches =
        (run.workflow.condition === "NO_SHOW_ONLY" && attendance === "NO_SHOW") ||
        (run.workflow.condition === "ATTENDED_ONLY" && attendance === "ATTENDED");
      const impossible =
        (run.workflow.condition === "NO_SHOW_ONLY" && attendance === "ATTENDED") ||
        (run.workflow.condition === "ATTENDED_ONLY" && attendance === "NO_SHOW");
      if (impossible) {
        await prisma.workflowRun.updateMany({
          where: { id: run.id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        continue;
      }
      if (!matches) continue;
    }

    // Claim the row before doing any work. If another runner got there first
    // the update matches nothing and we skip it, so overlapping cron
    // invocations cannot both send.
    const claim = await prisma.workflowRun.updateMany({
      where: { id: run.id, status: "PENDING" },
      data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;

    processed += 1;

    try {
      await executeSteps(run.workflowId, run.bookingId);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = run.attempts + 1;
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          lastError: message,
          sentAt: null,
          // Give up after three tries so one bad webhook does not retry forever.
          status: attempts >= 3 ? "FAILED" : "PENDING",
        },
      });
      failed += 1;
    }
  }

  return { processed, sent, failed };
}

/** Human-readable summary of when a workflow fires, for the dashboard. */
export function describeTiming(trigger: WorkflowTrigger, offsetMinutes: number): string {
  if (trigger === "BOOKING_CREATED") return "Immediately when booked";
  if (trigger === "BOOKING_CANCELLED") return "When a booking is cancelled";
  if (trigger === "BOOKING_RESCHEDULED") return "When a booking is rescheduled";
  const amount = DateTime.fromMillis(0)
    .plus({ minutes: offsetMinutes })
    .diff(DateTime.fromMillis(0))
    .shiftTo(offsetMinutes >= 1440 ? "days" : offsetMinutes >= 60 ? "hours" : "minutes")
    .toHuman({ maximumFractionDigits: 0 });
  return trigger === "BEFORE_EVENT" ? `${amount} before the meeting` : `${amount} after the meeting`;
}
