import { DateTime, Interval } from "luxon";

/**
 * The availability engine.
 *
 * Everything here is pure: it takes the host's rules plus whatever is already
 * busy and returns bookable slots. No database, no network — which is what
 * makes it testable and what makes double bookings a solved problem instead of
 * a recurring bug.
 *
 * All Date values crossing this boundary are absolute instants (UTC). Working
 * hours are stored as minutes-from-midnight in the *schedule's* timezone, so
 * 9:00–17:00 stays 9:00–17:00 through a DST change.
 */

export interface TimeWindow {
  startMinute: number; // minutes from midnight, schedule timezone
  endMinute: number;
}

export interface WeeklyRule extends TimeWindow {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
}

export interface DateOverrideInput {
  /** ISO date, e.g. "2026-11-26" — interpreted in the schedule timezone. */
  date: string;
  /** Empty = unavailable all day. */
  windows: TimeWindow[];
}

export interface BusyInterval {
  start: Date;
  end: Date;
  /** Bookings for the same slot of a group event do not block that slot. */
  slotKey?: string;
}

export interface SlotRequest {
  /** Search range (absolute instants). */
  rangeStart: Date;
  rangeEnd: Date;
  now?: Date;

  scheduleTimezone: string;
  rules: WeeklyRule[];
  overrides?: DateOverrideInput[];

  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  minimumNoticeMinutes?: number;
  rollingDays?: number;
  maxBookingsPerDay?: number | null;
  seatsPerSlot?: number;

  /** Host's existing bookings and external calendar busy blocks. */
  busy?: BusyInterval[];
  /** Confirmed bookings per ISO date (schedule timezone) for the daily cap. */
  bookingsPerDay?: Record<string, number>;
  /** Seats already taken, keyed by slot start ISO, for group events. */
  seatsTaken?: Record<string, number>;
}

export interface Slot {
  start: Date;
  end: Date;
  /** Only meaningful when seatsPerSlot > 1. */
  seatsLeft: number;
}

const MINUTES = 60 * 1000;

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Merge overlapping/adjacent busy intervals so conflict checks stay cheap. */
export function mergeBusy(busy: BusyInterval[]): Array<{ start: number; end: number }> {
  const sorted = busy
    .map((b) => ({ start: b.start.getTime(), end: b.end.getTime() }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

/** Windows that apply on a given calendar date, override taking precedence. */
export function windowsForDate(
  date: DateTime,
  rules: WeeklyRule[],
  overrides: DateOverrideInput[],
): TimeWindow[] {
  const iso = date.toISODate();
  const override = overrides.find((o) => o.date === iso);
  if (override) return normalizeWindows(override.windows);
  // Luxon weekday: 1 = Monday .. 7 = Sunday. Our storage: 0 = Sunday.
  const dow = date.weekday % 7;
  return normalizeWindows(rules.filter((r) => r.dayOfWeek === dow));
}

/** Sort, clamp to the day, and merge overlapping working windows. */
function normalizeWindows(windows: TimeWindow[]): TimeWindow[] {
  const cleaned = windows
    .map((w) => ({
      startMinute: Math.max(0, Math.min(1440, w.startMinute)),
      endMinute: Math.max(0, Math.min(1440, w.endMinute)),
    }))
    .filter((w) => w.endMinute > w.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute);

  const merged: TimeWindow[] = [];
  for (const w of cleaned) {
    const last = merged[merged.length - 1];
    if (last && w.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, w.endMinute);
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

export function computeSlots(req: SlotRequest): Slot[] {
  const {
    scheduleTimezone,
    rules,
    overrides = [],
    durationMinutes,
    slotIntervalMinutes,
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0,
    minimumNoticeMinutes = 0,
    rollingDays,
    maxBookingsPerDay,
    seatsPerSlot = 1,
    busy = [],
    bookingsPerDay = {},
    seatsTaken = {},
  } = req;

  if (durationMinutes <= 0) return [];
  const interval = slotIntervalMinutes > 0 ? slotIntervalMinutes : durationMinutes;
  const now = req.now ?? new Date();

  // Earliest bookable instant: minimum notice from now.
  const earliest = now.getTime() + minimumNoticeMinutes * MINUTES;
  // Latest bookable instant: end of the rolling window, in the schedule's tz.
  const latest =
    rollingDays && rollingDays > 0
      ? DateTime.fromJSDate(now, { zone: scheduleTimezone })
          .plus({ days: rollingDays })
          .endOf("day")
          .toMillis()
      : Number.POSITIVE_INFINITY;

  const windowStart = Math.max(req.rangeStart.getTime(), earliest);
  const windowEnd = Math.min(req.rangeEnd.getTime(), latest);
  if (windowEnd <= windowStart) return [];

  const mergedBusy = mergeBusy(busy);
  const slots: Slot[] = [];

  // Walk calendar dates in the schedule timezone. Start one day early so a
  // window that begins late on the previous local day is still considered.
  let cursor = DateTime.fromMillis(windowStart, { zone: scheduleTimezone }).startOf("day").minus({ days: 1 });
  const lastDay = DateTime.fromMillis(windowEnd, { zone: scheduleTimezone }).startOf("day");

  while (cursor <= lastDay) {
    const isoDate = cursor.toISODate()!;
    const dayCount = bookingsPerDay[isoDate] ?? 0;
    const dayIsFull = typeof maxBookingsPerDay === "number" && dayCount >= maxBookingsPerDay;

    if (!dayIsFull) {
      for (const win of windowsForDate(cursor, rules, overrides)) {
        // First slot start on the grid at or after the window opens.
        let minute = Math.ceil(win.startMinute / interval) * interval;

        while (minute + durationMinutes <= win.endMinute) {
          // Set the wall-clock time rather than adding minutes: on a DST
          // transition day the local day is 23 or 25 hours long, so
          // `plus({minutes})` would slide every slot by an hour.
          const start = cursor.set({
            hour: Math.floor(minute / 60),
            minute: minute % 60,
            second: 0,
            millisecond: 0,
          });
          const end = start.plus({ minutes: durationMinutes });
          const startMs = start.toMillis();
          const endMs = end.toMillis();
          minute += interval;

          if (startMs < windowStart || startMs >= windowEnd) continue;

          // Buffers pad the instant checked against other events, not the
          // event itself — the invitee still books a clean 30 minutes.
          const guardStart = startMs - bufferBeforeMinutes * MINUTES;
          const guardEnd = endMs + bufferAfterMinutes * MINUTES;

          const taken = seatsTaken[start.toUTC().toISO()!] ?? 0;
          const seatsLeft = seatsPerSlot - taken;
          if (seatsLeft <= 0) continue;

          // A group event with seats left is not blocked by its own bookings;
          // those are excluded from `busy` by the caller.
          const conflict = mergedBusy.some((b) => overlaps(guardStart, guardEnd, b.start, b.end));
          if (conflict) continue;

          slots.push({ start: start.toJSDate(), end: end.toJSDate(), seatsLeft });
        }
      }
    }
    cursor = cursor.plus({ days: 1 });
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  // A window can be listed twice across the day boundary walk; de-duplicate.
  return slots.filter((s, i) => i === 0 || s.start.getTime() !== slots[i - 1].start.getTime());
}

/** Group slots by calendar date in the viewer's timezone, for the UI. */
export function groupSlotsByDay(slots: Slot[], timezone: string): Record<string, Slot[]> {
  const out: Record<string, Slot[]> = {};
  for (const slot of slots) {
    const key = DateTime.fromJSDate(slot.start).setZone(timezone).toISODate()!;
    (out[key] ||= []).push(slot);
  }
  return out;
}

/** True when `candidate` is still free — the check re-run at booking time. */
export function isSlotBookable(candidate: { start: Date; end: Date }, slots: Slot[]): boolean {
  return slots.some(
    (s) =>
      s.start.getTime() === candidate.start.getTime() &&
      s.end.getTime() === candidate.end.getTime(),
  );
}

export { Interval };
