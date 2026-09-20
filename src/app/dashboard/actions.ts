"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BASE_PATH } from "@/lib/env";
import { requireHost } from "@/lib/auth";
import { cancelBooking, markAttendance } from "@/lib/bookings";
import { DEFAULT_TEMPLATES } from "@/lib/templates";
import { isPlausibleWebhookUrl, sanitizeRedirectUrl } from "@/lib/url-safety";
import type {
  LocationType,
  QuestionType,
  WorkflowTrigger,
  WorkflowAction,
  WorkflowCondition,
  AttendanceStatus,
} from "@prisma/client";

/** Every action re-checks the session host and scopes writes to that host. */

/**
 * Numbers arrive from HTML inputs as strings, and an emptied number field
 * submits "". Number("") is 0, which would silently set a duration of zero and
 * take an event type dark with no error — so every numeric field is parsed
 * with a fallback and clamped to a sane range.
 */
function num(
  formData: FormData,
  key: string,
  fallback: number,
  { min = 0, max = 100_000 }: { min?: number; max?: number } = {},
): number {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** CSS never needs angle brackets; stripping them closes the `</style>` escape. */
function sanitizeCss(value: string): string {
  return value.replace(/[<>]/g, "").slice(0, 20_000);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------- event types

export async function createEventType(formData: FormData) {
  const host = await requireHost();
  const title = String(formData.get("title") ?? "").trim() || "New meeting";
  let slug = slugify(String(formData.get("slug") ?? "") || title);

  // Slugs are unique per host; append a counter rather than failing the save.
  const existing = await prisma.eventType.findMany({
    where: { hostId: host.id, slug: { startsWith: slug } },
    select: { slug: true },
  });
  if (existing.some((e) => e.slug === slug)) slug = `${slug}-${existing.length + 1}`;

  const schedule = await prisma.schedule.findFirst({ where: { hostId: host.id, isDefault: true } });

  await prisma.eventType.create({
    data: {
      hostId: host.id,
      scheduleId: schedule?.id,
      title,
      slug,
      durationMinutes: num(formData, "durationMinutes", 30, { min: 5, max: 1440 }),
      description: String(formData.get("description") ?? "") || null,
    },
  });
  revalidatePath("/dashboard/event-types");
}

export async function updateEventType(formData: FormData) {
  const host = await requireHost();
  const id = String(formData.get("id"));
  const owned = await prisma.eventType.findFirst({ where: { id, hostId: host.id } });
  if (!owned) throw new Error("Not found");

  const maxPerDay = String(formData.get("maxBookingsPerDay") ?? "").trim();

  // A schedule id arrives from a form field, so confirm it belongs to this
  // host before attaching it — the foreign key only checks that it exists.
  const requestedScheduleId = String(formData.get("scheduleId") ?? "");
  let scheduleId: string | null = null;
  if (requestedScheduleId) {
    const schedule = await prisma.schedule.findFirst({
      where: { id: requestedScheduleId, hostId: host.id },
      select: { id: true },
    });
    scheduleId = schedule?.id ?? null;
  }

  await prisma.eventType.update({
    where: { id },
    data: {
      title: String(formData.get("title") ?? owned.title),
      slug: slugify(String(formData.get("slug") ?? owned.slug)) || owned.slug,
      description: String(formData.get("description") ?? "") || null,
      emailNote: String(formData.get("emailNote") ?? "").trim().slice(0, 2000) || null,
      emailHighlight: String(formData.get("emailHighlight") ?? "").trim().slice(0, 200) || null,
      color: String(formData.get("color") ?? owned.color),
      durationMinutes: num(formData, "durationMinutes", owned.durationMinutes, { min: 5, max: 1440 }),
      slotIntervalMinutes: num(formData, "slotIntervalMinutes", owned.slotIntervalMinutes, { min: 5, max: 1440 }),
      bufferBeforeMinutes: num(formData, "bufferBeforeMinutes", 0, { max: 1440 }),
      bufferAfterMinutes: num(formData, "bufferAfterMinutes", 0, { max: 1440 }),
      minimumNoticeMinutes: num(formData, "minimumNoticeMinutes", 0, { max: 525_600 }),
      rollingDays: num(formData, "rollingDays", owned.rollingDays, { min: 1, max: 730 }),
      maxBookingsPerDay: maxPerDay === "" ? null : num(formData, "maxBookingsPerDay", 1, { min: 1, max: 500 }),
      seatsPerSlot: num(formData, "seatsPerSlot", 1, { min: 1, max: 1000 }),
      locationType: String(formData.get("locationType") ?? owned.locationType) as LocationType,
      locationValue: String(formData.get("locationValue") ?? "") || null,
      // `javascript:` in here would execute in the invitee's browser after a
      // successful booking.
      redirectUrl: sanitizeRedirectUrl(String(formData.get("redirectUrl") ?? "")),
      requiresConfirmation: formData.get("requiresConfirmation") === "on",
      isActive: formData.get("isActive") === "on",
      isHidden: formData.get("isHidden") === "on",
      scheduleId,
    },
  });
  revalidatePath("/dashboard/event-types");
}

export async function deleteEventType(formData: FormData) {
  const host = await requireHost();
  const id = String(formData.get("id"));
  await prisma.eventType.deleteMany({ where: { id, hostId: host.id } });
  revalidatePath("/dashboard/event-types");
}

/** The card's Turn on / Turn off button. Off = link still resolves, no new bookings. */
export async function toggleEventType(formData: FormData) {
  const host = await requireHost();
  const id = String(formData.get("id"));
  const owned = await prisma.eventType.findFirst({
    where: { id, hostId: host.id },
    select: { isActive: true },
  });
  if (!owned) throw new Error("Not found");
  await prisma.eventType.update({ where: { id }, data: { isActive: !owned.isActive } });
  revalidatePath("/dashboard/event-types");
}

export async function addQuestion(formData: FormData) {
  const host = await requireHost();
  const eventTypeId = String(formData.get("eventTypeId"));
  const owned = await prisma.eventType.findFirst({ where: { id: eventTypeId, hostId: host.id } });
  if (!owned) throw new Error("Not found");

  const count = await prisma.bookingQuestion.count({ where: { eventTypeId } });
  await prisma.bookingQuestion.create({
    data: {
      eventTypeId,
      label: String(formData.get("label") ?? "Question"),
      type: String(formData.get("type") ?? "TEXT") as QuestionType,
      required: formData.get("required") === "on",
      options: String(formData.get("options") ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
      position: count,
    },
  });
  revalidatePath(`/dashboard/event-types/${eventTypeId}`);
}

export async function deleteQuestion(formData: FormData) {
  const host = await requireHost();
  const id = String(formData.get("id"));
  const question = await prisma.bookingQuestion.findFirst({
    where: { id, eventType: { hostId: host.id } },
  });
  if (!question) return;
  await prisma.bookingQuestion.delete({ where: { id } });
  revalidatePath(`/dashboard/event-types/${question.eventTypeId}`);
}

// ---------------------------------------------------------------- availability

export async function saveSchedule(formData: FormData) {
  const host = await requireHost();
  const scheduleId = String(formData.get("scheduleId"));
  const owned = await prisma.schedule.findFirst({ where: { id: scheduleId, hostId: host.id } });
  if (!owned) throw new Error("Not found");

  const rules: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> = [];
  for (let day = 0; day < 7; day += 1) {
    if (formData.get(`enabled_${day}`) !== "on") continue;
    const start = parseTime(String(formData.get(`start_${day}`) ?? "09:00"));
    const end = parseTime(String(formData.get(`end_${day}`) ?? "17:00"));
    if (end > start) rules.push({ dayOfWeek: day, startMinute: start, endMinute: end });
  }

  await prisma.$transaction([
    prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        name: String(formData.get("name") ?? owned.name),
        timezone: String(formData.get("timezone") ?? owned.timezone),
      },
    }),
    prisma.availabilityRule.deleteMany({ where: { scheduleId } }),
    prisma.availabilityRule.createMany({ data: rules.map((r) => ({ ...r, scheduleId })) }),
  ]);
  revalidatePath("/dashboard/availability");
}

function parseTime(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export async function addDateOverride(formData: FormData) {
  const host = await requireHost();
  const scheduleId = String(formData.get("scheduleId"));
  const owned = await prisma.schedule.findFirst({ where: { id: scheduleId, hostId: host.id } });
  if (!owned) throw new Error("Not found");

  const date = String(formData.get("date"));
  const unavailable = formData.get("unavailable") === "on";
  const windows = unavailable
    ? []
    : [
        {
          startMinute: parseTime(String(formData.get("start") ?? "09:00")),
          endMinute: parseTime(String(formData.get("end") ?? "17:00")),
        },
      ];

  await prisma.dateOverride.upsert({
    where: { scheduleId_date: { scheduleId, date: new Date(`${date}T00:00:00Z`) } },
    update: { windows, note: String(formData.get("note") ?? "") || null },
    create: {
      scheduleId,
      date: new Date(`${date}T00:00:00Z`),
      windows,
      note: String(formData.get("note") ?? "") || null,
    },
  });
  revalidatePath("/dashboard/availability");
}

export async function deleteDateOverride(formData: FormData) {
  const host = await requireHost();
  // Scoped delete: removing someone else's blackout date would quietly open
  // their calendar for booking.
  await prisma.dateOverride.deleteMany({
    where: { id: String(formData.get("id")), schedule: { hostId: host.id } },
  });
  revalidatePath("/dashboard/availability");
}

// ---------------------------------------------------------------- calendars

export async function setCalendarFlags(formData: FormData) {
  const host = await requireHost();
  const id = String(formData.get("id"));
  const calendar = await prisma.calendar.findFirst({
    where: { id, account: { hostId: host.id } },
  });
  if (!calendar) throw new Error("Not found");

  const makeWriteTarget = formData.get("isWriteTarget") === "on";
  if (makeWriteTarget) {
    // Exactly one write target per host.
    await prisma.calendar.updateMany({
      where: { account: { hostId: host.id } },
      data: { isWriteTarget: false },
    });
  }
  await prisma.calendar.update({
    where: { id },
    data: { checkConflicts: formData.get("checkConflicts") === "on", isWriteTarget: makeWriteTarget },
  });
  revalidatePath("/dashboard/calendars");
}

/** Host-level privacy switch for the Google Calendar sync (see Host.inviteAttendeesOnCalendar). */
export async function setInviteAttendees(formData: FormData) {
  const host = await requireHost();
  await prisma.host.update({
    where: { id: host.id },
    data: { inviteAttendeesOnCalendar: formData.get("inviteAttendeesOnCalendar") === "on" },
  });
  revalidatePath("/dashboard/calendars");
}

export async function disconnectCalendarAccount(formData: FormData) {
  const host = await requireHost();
  await prisma.calendarAccount.deleteMany({
    where: { id: String(formData.get("id")), hostId: host.id },
  });
  revalidatePath("/dashboard/calendars");
}

// ---------------------------------------------------------------- workflows

export async function createWorkflow(formData: FormData) {
  const host = await requireHost();
  const preset = String(formData.get("preset") ?? "reminder24h");

  const presets: Record<
    string,
    { name: string; trigger: WorkflowTrigger; offset: number; action: WorkflowAction; template: { subject: string; body: string } }
  > = {
    reminder24h: {
      name: "Reminder — 24 hours before",
      trigger: "BEFORE_EVENT",
      offset: 1440,
      action: "EMAIL_INVITEE",
      template: DEFAULT_TEMPLATES.reminder24h,
    },
    reminder1h: {
      name: "Reminder — 1 hour before",
      trigger: "BEFORE_EVENT",
      offset: 60,
      action: "EMAIL_INVITEE",
      template: DEFAULT_TEMPLATES.reminder1h,
    },
    followUp: {
      name: "Follow-up after the meeting",
      trigger: "AFTER_EVENT",
      offset: 60,
      action: "EMAIL_INVITEE",
      template: DEFAULT_TEMPLATES.followUp,
    },
    hostHeadsUp: {
      name: "Heads-up to host — 15 minutes before",
      trigger: "BEFORE_EVENT",
      offset: 15,
      action: "EMAIL_HOST",
      template: {
        subject: "In 15 minutes: {{event_title}} with {{invitee_name}}",
        body: "{{invitee_name}} ({{invitee_email}}) at {{event_time}}.\n\nNotes: {{invitee_notes}}\n{{booking_url}}",
      },
    },
    crmWebhook: {
      name: "Send booking to HubSpot (generic webhook)",
      trigger: "BOOKING_CREATED",
      offset: 0,
      action: "WEBHOOK",
      template: { subject: "", body: "" },
    },
    crmNote: {
      name: "HubSpot note — 1 hour after the meeting",
      trigger: "AFTER_EVENT",
      offset: 60,
      action: "CRM_LOG_NOTE",
      template: {
        subject: "",
        body: "Follow-up sent 1 hour after {{event_title}} with {{invitee_name}}.",
      },
    },
  };

  const config = presets[preset] ?? presets.reminder24h;

  await prisma.workflow.create({
    data: {
      hostId: host.id,
      name: config.name,
      trigger: config.trigger,
      offsetMinutes: config.offset,
      allEventTypes: true,
      steps: {
        create: {
          action: config.action,
          subject: config.template.subject || null,
          body: config.template.body || null,
          includeIcs: false,
          position: 0,
        },
      },
    },
  });
  revalidatePath("/dashboard/workflows");
}

/**
 * One click creates a staged follow-up sequence (1 hour / 1 day / 3 days
 * after the meeting) as three independent AFTER_EVENT workflows -- the
 * engine already schedules one WorkflowRun per matching workflow per
 * booking, so "staged" needs no new scheduling machinery, just three rows
 * instead of one. `condition` optionally gates all three on attendance
 * (e.g. NO_SHOW_ONLY for a "we missed you" sequence).
 */
export async function createFollowUpSequence(formData: FormData) {
  const host = await requireHost();
  const condition = (String(formData.get("condition") ?? "ANY") as WorkflowCondition) || "ANY";

  const stages: Array<{ label: string; offsetMinutes: number; body: string }> = [
    {
      label: "1 hour after",
      offsetMinutes: 60,
      body: "Hi {{invitee_name}},\n\nThanks for the time earlier — following up while it's fresh. Any questions from our conversation?\n\n{{host_name}}",
    },
    {
      label: "1 day after",
      offsetMinutes: 1440,
      body: "Hi {{invitee_name}},\n\nChecking in a day later — happy to go deeper on anything we covered, or set up a next step.\n\n{{host_name}}",
    },
    {
      label: "3 days after",
      offsetMinutes: 4320,
      body: "Hi {{invitee_name}},\n\nLast note from me on this — let me know if now isn't the right time, or if you'd like to keep the conversation going.\n\n{{host_name}}",
    },
  ];

  const conditionLabel =
    condition === "NO_SHOW_ONLY" ? " (no-shows only)" : condition === "ATTENDED_ONLY" ? " (attended only)" : "";

  for (const stage of stages) {
    await prisma.workflow.create({
      data: {
        hostId: host.id,
        name: `Follow-up sequence — ${stage.label}${conditionLabel}`,
        trigger: "AFTER_EVENT",
        offsetMinutes: stage.offsetMinutes,
        condition,
        allEventTypes: true,
        steps: {
          create: {
            action: "EMAIL_INVITEE",
            subject: "Following up — {{event_title}}",
            body: stage.body,
            includeIcs: false,
            position: 0,
          },
        },
      },
    });
  }
  revalidatePath("/dashboard/workflows");
}

export async function updateWorkflow(formData: FormData) {
  const host = await requireHost();
  const id = String(formData.get("id"));
  const workflow = await prisma.workflow.findFirst({
    where: { id, hostId: host.id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!workflow) throw new Error("Not found");

  const conditionRaw = formData.get("condition");
  const condition: WorkflowCondition | undefined =
    conditionRaw && ["ANY", "NO_SHOW_ONLY", "ATTENDED_ONLY"].includes(String(conditionRaw))
      ? (String(conditionRaw) as WorkflowCondition)
      : undefined;

  await prisma.workflow.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? workflow.name),
      offsetMinutes: num(formData, "offsetMinutes", workflow.offsetMinutes, { max: 525_600 }),
      isActive: formData.get("isActive") === "on",
      ...(condition ? { condition } : {}),
    },
  });

  const step = workflow.steps[0];
  if (step) {
    const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
    if (webhookUrl && !isPlausibleWebhookUrl(webhookUrl)) {
      throw new Error("Webhook URL must be a public https:// address");
    }
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        subject: String(formData.get("subject") ?? "") || null,
        body: String(formData.get("body") ?? "") || null,
        webhookUrl: webhookUrl || null,
        includeIcs: formData.get("includeIcs") === "on",
      },
    });
  }
  revalidatePath("/dashboard/workflows");
}

export async function deleteWorkflow(formData: FormData) {
  const host = await requireHost();
  await prisma.workflow.deleteMany({ where: { id: String(formData.get("id")), hostId: host.id } });
  revalidatePath("/dashboard/workflows");
}

// ---------------------------------------------------------------- branding

export async function saveBranding(formData: FormData) {
  const host = await requireHost();
  await prisma.host.update({
    where: { id: host.id },
    data: {
      name: String(formData.get("name") ?? host.name),
      slug: slugify(String(formData.get("slug") ?? host.slug)) || host.slug,
      timezone: String(formData.get("timezone") ?? host.timezone),
      headline: String(formData.get("headline") ?? "") || null,
      welcomeText: String(formData.get("welcomeText") ?? "") || null,
      avatarUrl: String(formData.get("avatarUrl") ?? "") || null,
      logoUrl: String(formData.get("logoUrl") ?? "") || null,
      brandColor: String(formData.get("brandColor") ?? host.brandColor),
      accentTextOn: String(formData.get("accentTextOn") ?? host.accentTextOn),
      pageBackground: String(formData.get("pageBackground") ?? host.pageBackground),
      customCss: sanitizeCss(String(formData.get("customCss") ?? "")) || null,
      showPoweredBy: formData.get("showPoweredBy") === "on",
    },
  });
  revalidatePath("/dashboard/branding");
}

// ---------------------------------------------------------------- bookings

export async function hostCancelBooking(formData: FormData) {
  const host = await requireHost();
  const uid = String(formData.get("uid"));
  const booking = await prisma.booking.findFirst({ where: { uid, hostId: host.id } });
  if (!booking) throw new Error("Not found");
  await cancelBooking(uid, "host", String(formData.get("reason") ?? "") || undefined);
  revalidatePath("/dashboard");
}

export async function confirmBooking(formData: FormData) {
  const host = await requireHost();
  const uid = String(formData.get("uid"));
  const booking = await prisma.booking.findFirst({ where: { uid, hostId: host.id } });
  if (!booking || booking.status !== "PENDING") return;

  await prisma.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } });
  const { syncToCalendar, syncToCrm, sendBookingEmail } = await import("@/lib/bookings");
  await syncToCalendar(booking.id).catch(() => undefined);
  await syncToCrm(booking.id).catch(() => undefined);
  await sendBookingEmail(booking.id, "confirmation").catch(() => undefined);
  revalidatePath("/dashboard");
}

/** Host marks whether the invitee showed up -- gates NO_SHOW_ONLY / ATTENDED_ONLY workflows. */
export async function setBookingAttendance(formData: FormData) {
  const host = await requireHost();
  const uid = String(formData.get("uid"));
  const status = String(formData.get("status") ?? "") as AttendanceStatus;
  if (!["UNKNOWN", "ATTENDED", "NO_SHOW"].includes(status)) throw new Error("Invalid attendance status");

  const booking = await prisma.booking.findFirst({ where: { uid, hostId: host.id } });
  if (!booking) throw new Error("Not found");

  await markAttendance(uid, status);
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------- CRM (HubSpot)

export async function disconnectCrmAccount(formData: FormData) {
  const host = await requireHost();
  await prisma.crmAccount.deleteMany({
    where: { id: String(formData.get("id")), hostId: host.id, provider: "HUBSPOT" },
  });
  revalidatePath("/dashboard/integrations");
}

/**
 * Connect HubSpot with a Private App access token (no developer account or
 * OAuth app required). The token is verified against HubSpot before it is
 * stored; problems come back as a readable message on the Integrations page.
 */
export async function connectHubSpotToken(formData: FormData) {
  const host = await requireHost();
  const { connectWithPrivateAppToken } = await import("@/lib/hubspot");
  let error: string | null = null;
  try {
    await connectWithPrivateAppToken(host.id, String(formData.get("token") ?? ""));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/dashboard/integrations");
  // redirect() throws to unwind the action, so it stays outside the try/catch.
  redirect(`${BASE_PATH()}/dashboard/integrations?${error ? `error=${encodeURIComponent(error)}` : "connected=1"}`);
}
