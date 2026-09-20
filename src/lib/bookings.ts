import { DateTime } from "luxon";
import { Prisma, type Booking, type BookingStatus, type AttendanceStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { computeSlots, type BusyInterval, type Slot } from "./availability";
import { getBusyTimes, createCalendarEvent, deleteCalendarEvent, updateCalendarEventTime } from "./google";
import { getActiveHubSpotAccount, upsertContact, logMeetingEngagement, updateMeetingOutcome } from "./hubspot";
import { newBookingUid } from "./crypto";
import { bookingVars, describeLocation, DEFAULT_TEMPLATES, renderTemplate } from "./templates";
import { sendMail } from "./mail";
import { buildIcs } from "./ics";
import { cancelRunsForBooking, scheduleWorkflowRuns, runWorkflowsNow } from "./workflows";
import { publicUrl } from "./env";
import { VIDEO_LINK_LOCATIONS } from "./locations";

const ACTIVE: BookingStatus[] = ["CONFIRMED", "PENDING"];

export type EventTypeWithHost = Prisma.EventTypeGetPayload<{
  include: {
    host: true;
    questions: true;
    schedule: { include: { rules: true; overrides: true } };
  };
}>;

export async function loadEventType(hostSlug: string, eventSlug: string) {
  const host = await prisma.host.findUnique({ where: { slug: hostSlug } });
  if (!host || !host.isActive) return null;
  return prisma.eventType.findFirst({
    where: { hostId: host.id, slug: eventSlug, isActive: true },
    include: {
      host: true,
      questions: { orderBy: { position: "asc" } },
      schedule: { include: { rules: true, overrides: true } },
    },
  });
}

/** The schedule actually used: the one attached to the event type, else default. */
async function resolveSchedule(eventType: EventTypeWithHost) {
  if (eventType.schedule) return eventType.schedule;
  return prisma.schedule.findFirst({
    where: { hostId: eventType.hostId, isDefault: true },
    include: { rules: true, overrides: true },
  });
}

export interface SlotQuery {
  from: Date;
  to: Date;
  now?: Date;
  /** Skip the Google round-trip (tests, or when no calendar is connected). */
  skipExternal?: boolean;
  /**
   * Ignore this booking when looking for conflicts. Used when rescheduling, so
   * a booking is not treated as blocking its own new time.
   */
  excludeBookingId?: string;
}

export async function getAvailableSlots(
  eventType: EventTypeWithHost,
  query: SlotQuery,
): Promise<Slot[]> {
  const schedule = await resolveSchedule(eventType);
  if (!schedule) return [];

  const now = query.now ?? new Date();
  // Pad the busy lookup by a day on each side so buffers near the edges work.
  const busyFrom = new Date(query.from.getTime() - 24 * 3600 * 1000);
  const busyTo = new Date(query.to.getTime() + 24 * 3600 * 1000);

  const bookings = await prisma.booking.findMany({
    where: {
      hostId: eventType.hostId,
      status: { in: ACTIVE },
      startsAt: { lt: busyTo },
      endsAt: { gt: busyFrom },
      ...(query.excludeBookingId ? { id: { not: query.excludeBookingId } } : {}),
    },
    select: { startsAt: true, endsAt: true, eventTypeId: true },
  });

  const isGroupEvent = eventType.seatsPerSlot > 1;
  const seatsTaken: Record<string, number> = {};
  const busy: BusyInterval[] = [];

  for (const b of bookings) {
    if (isGroupEvent && b.eventTypeId === eventType.id) {
      const key = DateTime.fromJSDate(b.startsAt).toUTC().toISO()!;
      seatsTaken[key] = (seatsTaken[key] ?? 0) + 1;
      continue; // seats, not a conflict
    }
    busy.push({ start: b.startsAt, end: b.endsAt });
  }

  if (!query.skipExternal) {
    const external = await getBusyTimes(eventType.hostId, busyFrom, busyTo);
    busy.push(...external);
  }

  let bookingsPerDay: Record<string, number> = {};
  if (eventType.maxBookingsPerDay) {
    bookingsPerDay = await countBookingsPerDay(
      eventType.id,
      schedule.timezone,
      busyFrom,
      busyTo,
      query.excludeBookingId,
    );
  }

  return computeSlots({
    rangeStart: query.from,
    rangeEnd: query.to,
    now,
    scheduleTimezone: schedule.timezone,
    rules: schedule.rules.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
    })),
    overrides: schedule.overrides.map((o) => ({
      date: DateTime.fromJSDate(o.date, { zone: "utc" }).toISODate()!,
      windows: (o.windows as Array<{ startMinute: number; endMinute: number }>) ?? [],
    })),
    durationMinutes: eventType.durationMinutes,
    slotIntervalMinutes: eventType.slotIntervalMinutes,
    bufferBeforeMinutes: eventType.bufferBeforeMinutes,
    bufferAfterMinutes: eventType.bufferAfterMinutes,
    minimumNoticeMinutes: eventType.minimumNoticeMinutes,
    rollingDays: eventType.rollingDays,
    maxBookingsPerDay: eventType.maxBookingsPerDay,
    seatsPerSlot: eventType.seatsPerSlot,
    busy,
    bookingsPerDay,
    seatsTaken,
  });
}

async function countBookingsPerDay(
  eventTypeId: string,
  timezone: string,
  from: Date,
  to: Date,
  excludeBookingId?: string,
): Promise<Record<string, number>> {
  const rows = await prisma.booking.findMany({
    where: {
      eventTypeId,
      status: { in: ACTIVE },
      startsAt: { gte: from, lt: to },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    select: { startsAt: true },
  });
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = DateTime.fromJSDate(row.startsAt).setZone(timezone).toISODate()!;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export interface CreateBookingInput {
  eventType: EventTypeWithHost;
  start: Date;
  inviteeName: string;
  inviteeEmail: string;
  inviteeTimezone: string;
  inviteePhone?: string;
  inviteeNotes?: string;
  guestEmails?: string[];
  answers?: Record<string, unknown>;
  /** Set when this booking replaces another one. */
  rescheduledFromId?: string;
  skipExternal?: boolean;
  now?: Date;
}

export class SlotUnavailableError extends Error {
  constructor() {
    super("That time was just taken. Please pick another slot.");
    this.name = "SlotUnavailableError";
  }
}

/**
 * Create a booking.
 *
 * The slot is re-verified inside a transaction that holds a Postgres advisory
 * lock keyed on the host, so two invitees clicking the same 10:00 at the same
 * moment cannot both win. Calendar and email work happens after commit: a
 * Google outage should not lose a booking we already promised.
 */
export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const { eventType } = input;
  const end = new Date(input.start.getTime() + eventType.durationMinutes * 60000);
  const uid = newBookingUid();

  // Step 1 — full availability check outside any transaction. This can call
  // Google, so it must not run with a lock held.
  const slots = await getAvailableSlots(eventType, {
    from: new Date(input.start.getTime() - 60000),
    to: new Date(end.getTime() + 60000),
    now: input.now,
    skipExternal: input.skipExternal,
    excludeBookingId: input.rescheduledFromId,
  });
  if (!slots.some((s) => s.start.getTime() === input.start.getTime())) {
    throw new SlotUnavailableError();
  }

  // Step 2 — a short, database-only transaction that settles the race. The
  // advisory lock serialises bookings for this host, so two invitees clicking
  // the same 10:00 at the same moment cannot both win.
  const guardStart = new Date(input.start.getTime() - eventType.bufferBeforeMinutes * 60000);
  const guardEnd = new Date(end.getTime() + eventType.bufferAfterMinutes * 60000);

  const booking = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventType.hostId}))`;

    if (eventType.seatsPerSlot > 1) {
      const taken = await tx.booking.count({
        where: { eventTypeId: eventType.id, startsAt: input.start, status: { in: ACTIVE } },
      });
      if (taken >= eventType.seatsPerSlot) throw new SlotUnavailableError();
      // Other event types still conflict, even when this one has seats left.
      const clash = await tx.booking.findFirst({
        where: {
          hostId: eventType.hostId,
          status: { in: ACTIVE },
          eventTypeId: { not: eventType.id },
          startsAt: { lt: guardEnd },
          endsAt: { gt: guardStart },
        },
        select: { id: true },
      });
      if (clash) throw new SlotUnavailableError();
    } else {
      const clash = await tx.booking.findFirst({
        where: {
          hostId: eventType.hostId,
          status: { in: ACTIVE },
          startsAt: { lt: guardEnd },
          endsAt: { gt: guardStart },
          ...(input.rescheduledFromId ? { id: { not: input.rescheduledFromId } } : {}),
        },
        select: { id: true },
      });
      if (clash) throw new SlotUnavailableError();
    }

    return tx.booking.create({
      data: {
        uid,
        organizationId: eventType.host.organizationId,
        hostId: eventType.hostId,
        eventTypeId: eventType.id,
        startsAt: input.start,
        endsAt: end,
        timezone: eventType.host.timezone,
        status: eventType.requiresConfirmation ? "PENDING" : "CONFIRMED",
        inviteeName: input.inviteeName,
        inviteeEmail: input.inviteeEmail.toLowerCase().trim(),
        inviteePhone: input.inviteePhone,
        inviteeTimezone: input.inviteeTimezone,
        inviteeNotes: input.inviteeNotes,
        guestEmails: input.guestEmails ?? [],
        answers: (input.answers ?? {}) as Prisma.InputJsonValue,
        locationType: eventType.locationType,
        locationDetail: eventType.locationValue,
        // Zoom/Teams: the host's standing link is the meeting URL from the
        // start. Google Meet's is filled in later by syncToCalendar.
        meetingUrl: VIDEO_LINK_LOCATIONS.has(eventType.locationType) ? eventType.locationValue : null,
        rescheduledFromId: input.rescheduledFromId,
      },
    });
  });

  // --- post-commit side effects ------------------------------------------
  if (booking.status === "CONFIRMED") {
    await syncToCalendar(booking.id).catch((e) => console.error("[calendar] create failed", e));
    await syncToCrm(booking.id).catch((e) => console.error("[hubspot] create failed", e));
  }
  await scheduleWorkflowRuns(booking.id).catch((e) => console.error("[workflow] schedule failed", e));
  await sendBookingEmail(booking.id, input.rescheduledFromId ? "reschedule" : "confirmation").catch(
    (e) => console.error("[mail] confirmation failed", e),
  );
  await runWorkflowsNow(
    booking.id,
    input.rescheduledFromId ? "BOOKING_RESCHEDULED" : "BOOKING_CREATED",
  ).catch((e) => console.error("[workflow] immediate failed", e));

  return prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
}

/** Write the booking to the host's Google Calendar and store the event id. */
export async function syncToCalendar(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { eventType: true, host: true },
  });

  const result = await createCalendarEvent(booking.hostId, {
    summary: `${booking.eventType.title} — ${booking.inviteeName}`,
    description: [
      `Booked through Sothcare Scheduling.`,
      ``,
      `Invitee: ${booking.inviteeName} <${booking.inviteeEmail}>`,
      booking.inviteePhone ? `Phone: ${booking.inviteePhone}` : "",
      booking.inviteeNotes ? `\nNotes:\n${booking.inviteeNotes}` : "",
      ``,
      `Manage: ${publicUrl(`/booking/${booking.uid}`)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    start: booking.startsAt,
    end: booking.endsAt,
    timezone: booking.timezone,
    // Off by default: a personal Gmail write-target would otherwise appear as
    // organizer on the invitee's own calendar. Our branded email + .ics
    // still reach them either way.
    attendees: booking.host.inviteAttendeesOnCalendar ? [booking.inviteeEmail, ...booking.guestEmails] : [],
    location: booking.locationDetail ?? undefined,
    addMeet: booking.locationType === "GOOGLE_MEET",
  });

  if (!result) return;
  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      externalCalendarId: result.calendarId,
      externalEventId: result.eventId,
      meetingUrl: result.meetingUrl ?? booking.meetingUrl,
    },
  });
}

/**
 * Upsert the invitee as a HubSpot contact and log the booking as a Meeting
 * engagement on their timeline. A no-op (not an error) when the host hasn't
 * connected HubSpot -- this runs unconditionally on every confirmed booking,
 * same as syncToCalendar, so it can't be allowed to fail loudly for the
 * (currently default) case where there's nothing to sync to.
 */
export async function syncToCrm(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { eventType: true },
  });

  const account = await getActiveHubSpotAccount(booking.hostId);
  if (!account) return;

  const [firstname, ...rest] = booking.inviteeName.trim().split(/\s+/);
  const contactId = await upsertContact(account, {
    email: booking.inviteeEmail,
    firstname,
    lastname: rest.join(" ") || undefined,
    phone: booking.inviteePhone ?? undefined,
  });

  const engagementId = await logMeetingEngagement(account, {
    contactId,
    title: `${booking.eventType.title} with ${booking.inviteeName}`,
    body: booking.inviteeNotes ?? undefined,
    start: booking.startsAt,
    end: booking.endsAt,
    outcome: "SCHEDULED",
  });

  await prisma.crmSyncRecord.upsert({
    where: { bookingId: booking.id },
    update: { contactId, engagementId, lastSyncedAt: new Date(), lastError: null },
    create: { hostId: booking.hostId, bookingId: booking.id, contactId, engagementId },
  });
}

/**
 * Host marks whether the invitee actually showed up. Drives AFTER_EVENT
 * workflow conditions (NO_SHOW_ONLY / ATTENDED_ONLY) and, when connected,
 * updates the HubSpot meeting engagement's outcome to match.
 */
export async function markAttendance(uid: string, status: AttendanceStatus) {
  const booking = await prisma.booking.update({
    where: { uid },
    data: { attendanceStatus: status },
    include: { crmSyncRecord: true },
  });

  if (booking.crmSyncRecord?.engagementId) {
    const account = await getActiveHubSpotAccount(booking.hostId);
    if (account) {
      const outcome = status === "NO_SHOW" ? "NO_SHOW" : status === "ATTENDED" ? "COMPLETED" : undefined;
      if (outcome) {
        await updateMeetingOutcome(account, booking.crmSyncRecord.engagementId, outcome).catch((e) =>
          console.error("[hubspot] outcome update failed", e),
        );
      }
    }
  }

  return booking;
}

type EmailKind = "confirmation" | "cancellation" | "reschedule";

export async function sendBookingEmail(bookingId: string, kind: EmailKind) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { eventType: true, host: true },
  });
  const vars = bookingVars(booking, booking.eventType, booking.host);

  const template =
    kind === "cancellation"
      ? DEFAULT_TEMPLATES.cancellation
      : kind === "reschedule"
        ? DEFAULT_TEMPLATES.reschedule
        : DEFAULT_TEMPLATES.confirmationToInvitee;

  const ics = buildIcs({
    uid: `${booking.uid}@sothcare.com`,
    method: kind === "cancellation" ? "CANCEL" : "REQUEST",
    sequence: kind === "confirmation" ? 0 : 1,
    cancelled: kind === "cancellation",
    summary: `${booking.eventType.title} — ${booking.host.name}`,
    description: describeLocation(booking),
    location: describeLocation(booking),
    start: booking.startsAt,
    end: booking.endsAt,
    organizer: { name: booking.host.name, email: booking.host.email },
    attendees: [{ name: booking.inviteeName, email: booking.inviteeEmail }],
    url: publicUrl(`/booking/${booking.uid}`),
  });

  await sendMail({
    to: booking.inviteeEmail,
    cc: booking.guestEmails,
    subject: renderTemplate(template.subject, vars),
    text: renderTemplate(template.body, vars),
    replyTo: booking.host.email,
    bookingId: booking.id,
    kind,
    attachments: [
      {
        filename: kind === "cancellation" ? "cancelled.ics" : "invite.ics",
        content: ics,
        contentType: `text/calendar; method=${kind === "cancellation" ? "CANCEL" : "REQUEST"}; charset=utf-8`,
      },
    ],
  });

  if (kind === "confirmation") {
    const hostVars = bookingVars(booking, booking.eventType, booking.host, booking.host.timezone);
    await sendMail({
      to: booking.host.email,
      subject: renderTemplate(DEFAULT_TEMPLATES.confirmationToHost.subject, hostVars),
      text: renderTemplate(DEFAULT_TEMPLATES.confirmationToHost.body, hostVars),
      replyTo: booking.inviteeEmail,
      bookingId: booking.id,
      kind: "confirmation-host",
    });
  }
}

export async function cancelBooking(uid: string, by: "host" | "invitee", reason?: string) {
  const booking = await prisma.booking.findUnique({ where: { uid }, include: { crmSyncRecord: true } });
  if (!booking) return null;
  if (booking.status === "CANCELLED") return booking;

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: by, cancelReason: reason },
  });

  if (booking.externalCalendarId && booking.externalEventId) {
    await deleteCalendarEvent(booking.hostId, booking.externalCalendarId, booking.externalEventId).catch(
      (e) => console.error("[calendar] delete failed", e),
    );
  }
  if (booking.crmSyncRecord?.engagementId) {
    const account = await getActiveHubSpotAccount(booking.hostId);
    if (account) {
      await updateMeetingOutcome(account, booking.crmSyncRecord.engagementId, "CANCELED").catch((e) =>
        console.error("[hubspot] outcome update failed", e),
      );
    }
  }
  await cancelRunsForBooking(booking.id);
  await sendBookingEmail(booking.id, "cancellation").catch((e) => console.error("[mail]", e));
  await runWorkflowsNow(booking.id, "BOOKING_CANCELLED").catch((e) => console.error("[workflow]", e));

  return updated;
}

/**
 * Reschedule keeps the original row (audit trail) and creates a new booking
 * linked to it, then moves the calendar event rather than deleting it so the
 * invitee's own calendar entry updates in place.
 */
export async function rescheduleBooking(uid: string, newStart: Date, options?: { skipExternal?: boolean }) {
  const existing = await prisma.booking.findUnique({
    where: { uid },
    include: {
      eventType: {
        include: {
          host: true,
          questions: { orderBy: { position: "asc" } },
          schedule: { include: { rules: true, overrides: true } },
        },
      },
    },
  });
  // A stale reschedule link must not create a second replacement booking —
  // `rescheduledFromId` is unique, so that would surface as a raw 500.
  if (!existing || existing.status === "CANCELLED" || existing.status === "RESCHEDULED") return null;

  const created = await createBooking({
    eventType: existing.eventType,
    start: newStart,
    inviteeName: existing.inviteeName,
    inviteeEmail: existing.inviteeEmail,
    inviteeTimezone: existing.inviteeTimezone,
    inviteePhone: existing.inviteePhone ?? undefined,
    inviteeNotes: existing.inviteeNotes ?? undefined,
    guestEmails: existing.guestEmails,
    answers: existing.answers as Record<string, unknown>,
    rescheduledFromId: existing.id,
    skipExternal: options?.skipExternal,
  });

  await prisma.booking.update({
    where: { id: existing.id },
    data: { status: "RESCHEDULED" },
  });
  await cancelRunsForBooking(existing.id);

  if (existing.externalCalendarId && existing.externalEventId) {
    await updateCalendarEventTime(
      existing.hostId,
      existing.externalCalendarId,
      existing.externalEventId,
      created.startsAt,
      created.endsAt,
      created.timezone,
    ).catch((e) => console.error("[calendar] move failed", e));
    await prisma.booking.update({
      where: { id: created.id },
      data: {
        externalCalendarId: existing.externalCalendarId,
        externalEventId: existing.externalEventId,
        meetingUrl: existing.meetingUrl,
      },
    });
  }

  return created;
}
