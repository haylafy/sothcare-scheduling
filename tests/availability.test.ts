import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { computeSlots, mergeBusy, windowsForDate } from "../src/lib/availability";

const TZ = "America/Chicago";
const WEEKDAYS_9_TO_5 = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}));

function local(iso: string) {
  return DateTime.fromISO(iso, { zone: TZ }).toJSDate();
}

function labels(slots: Array<{ start: Date }>) {
  return slots.map((s) => DateTime.fromJSDate(s.start).setZone(TZ).toFormat("ccc HH:mm"));
}

const baseRequest = {
  scheduleTimezone: TZ,
  rules: WEEKDAYS_9_TO_5,
  durationMinutes: 30,
  slotIntervalMinutes: 15,
  minimumNoticeMinutes: 0,
};

test("fills the working window on the slot grid", () => {
  const slots = computeSlots({
    ...baseRequest,
    rangeStart: local("2026-09-15T00:00"), // Tuesday
    rangeEnd: local("2026-09-15T23:59"),
    now: local("2026-09-14T08:00"),
  });

  const times = labels(slots);
  assert.equal(times[0], "Tue 09:00");
  assert.equal(times.at(-1), "Tue 16:30"); // a 30-min slot must end by 17:00
  assert.equal(slots.length, 31);
});

test("weekends are closed when no rule covers them", () => {
  const slots = computeSlots({
    ...baseRequest,
    rangeStart: local("2026-09-19T00:00"), // Saturday
    rangeEnd: local("2026-09-20T23:59"),
    now: local("2026-09-14T08:00"),
  });
  assert.equal(slots.length, 0);
});

test("minimum notice hides slots that are too soon", () => {
  const slots = computeSlots({
    ...baseRequest,
    minimumNoticeMinutes: 240, // 4 hours
    rangeStart: local("2026-09-15T00:00"),
    rangeEnd: local("2026-09-15T23:59"),
    now: local("2026-09-15T09:00"),
  });
  assert.equal(labels(slots)[0], "Tue 13:00");
});

test("an existing booking blocks the slots it overlaps", () => {
  const slots = computeSlots({
    ...baseRequest,
    rangeStart: local("2026-09-15T00:00"),
    rangeEnd: local("2026-09-15T23:59"),
    now: local("2026-09-14T08:00"),
    busy: [{ start: local("2026-09-15T10:00"), end: local("2026-09-15T10:30") }],
  });
  const times = labels(slots);
  assert.ok(!times.includes("Tue 10:00"));
  assert.ok(!times.includes("Tue 09:45")); // would run into 10:00
  assert.ok(times.includes("Tue 09:30"));
  assert.ok(times.includes("Tue 10:30"));
});

test("buffers keep slots clear on both sides of a meeting", () => {
  const slots = computeSlots({
    ...baseRequest,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    rangeStart: local("2026-09-15T00:00"),
    rangeEnd: local("2026-09-15T23:59"),
    now: local("2026-09-14T08:00"),
    busy: [{ start: local("2026-09-15T10:00"), end: local("2026-09-15T10:30") }],
  });
  const times = labels(slots);
  assert.ok(!times.includes("Tue 09:30")); // ends 10:00, +15 buffer overlaps
  assert.ok(times.includes("Tue 09:15")); // ends 09:45, +15 = 10:00, clear
  assert.ok(!times.includes("Tue 10:30")); // -15 buffer reaches back into 10:15
  assert.ok(times.includes("Tue 10:45"));
});

test("a date override replaces the weekly hours", () => {
  const closed = computeSlots({
    ...baseRequest,
    overrides: [{ date: "2026-11-26", windows: [] }], // Thanksgiving
    rangeStart: local("2026-11-26T00:00"),
    rangeEnd: local("2026-11-26T23:59"),
    now: local("2026-11-20T08:00"),
  });
  assert.equal(closed.length, 0);

  const halfDay = computeSlots({
    ...baseRequest,
    overrides: [{ date: "2026-11-27", windows: [{ startMinute: 9 * 60, endMinute: 11 * 60 }] }],
    rangeStart: local("2026-11-27T00:00"),
    rangeEnd: local("2026-11-27T23:59"),
    now: local("2026-11-20T08:00"),
  });
  assert.equal(labels(halfDay).at(-1), "Fri 10:30");
});

test("working hours survive the spring-forward DST change", () => {
  // US DST starts Sunday 8 March 2026; Monday the 9th is the first day after.
  const before = computeSlots({
    ...baseRequest,
    rangeStart: local("2026-03-02T00:00"),
    rangeEnd: local("2026-03-02T23:59"),
    now: local("2026-02-25T08:00"),
  });
  const after = computeSlots({
    ...baseRequest,
    rangeStart: local("2026-03-09T00:00"),
    rangeEnd: local("2026-03-09T23:59"),
    now: local("2026-02-25T08:00"),
  });

  assert.equal(labels(before)[0], "Mon 09:00");
  assert.equal(labels(after)[0], "Mon 09:00");
  // Same local time, one hour apart in UTC — proof the offset was applied.
  assert.equal(before[0].start.toISOString().slice(11, 16), "15:00");
  assert.equal(after[0].start.toISOString().slice(11, 16), "14:00");
});

test("the rolling window caps how far ahead people can book", () => {
  const slots = computeSlots({
    ...baseRequest,
    rollingDays: 7,
    rangeStart: local("2026-09-14T00:00"),
    rangeEnd: local("2026-12-31T23:59"),
    now: local("2026-09-14T08:00"),
  });
  const last = DateTime.fromJSDate(slots.at(-1)!.start).setZone(TZ);
  assert.equal(last.toISODate(), "2026-09-21");
});

test("a daily cap closes the day once it is reached", () => {
  const slots = computeSlots({
    ...baseRequest,
    maxBookingsPerDay: 2,
    bookingsPerDay: { "2026-09-15": 2, "2026-09-16": 1 },
    rangeStart: local("2026-09-15T00:00"),
    rangeEnd: local("2026-09-16T23:59"),
    now: local("2026-09-14T08:00"),
  });
  const days = new Set(labels(slots).map((l) => l.slice(0, 3)));
  assert.deepEqual([...days], ["Wed"]);
});

test("group events keep offering a slot until the seats run out", () => {
  const slotIso = DateTime.fromJSDate(local("2026-09-15T09:00")).toUTC().toISO()!;

  const withSeats = computeSlots({
    ...baseRequest,
    seatsPerSlot: 10,
    seatsTaken: { [slotIso]: 3 },
    rangeStart: local("2026-09-15T09:00"),
    rangeEnd: local("2026-09-15T10:00"),
    now: local("2026-09-14T08:00"),
  });
  assert.equal(withSeats[0].seatsLeft, 7);

  const full = computeSlots({
    ...baseRequest,
    seatsPerSlot: 10,
    seatsTaken: { [slotIso]: 10 },
    rangeStart: local("2026-09-15T09:00"),
    rangeEnd: local("2026-09-15T10:00"),
    now: local("2026-09-14T08:00"),
  });
  assert.ok(!labels(full).includes("Tue 09:00"));
});

test("split shifts produce two blocks of slots", () => {
  const slots = computeSlots({
    ...baseRequest,
    rules: [
      { dayOfWeek: 2, startMinute: 8 * 60, endMinute: 10 * 60 },
      { dayOfWeek: 2, startMinute: 14 * 60, endMinute: 16 * 60 },
    ],
    rangeStart: local("2026-09-15T00:00"),
    rangeEnd: local("2026-09-15T23:59"),
    now: local("2026-09-14T08:00"),
  });
  const times = labels(slots);
  assert.equal(times[0], "Tue 08:00");
  assert.ok(!times.includes("Tue 10:00"));
  assert.ok(times.includes("Tue 14:00"));
  assert.equal(times.at(-1), "Tue 15:30");
});

test("overlapping busy intervals collapse", () => {
  const merged = mergeBusy([
    { start: new Date("2026-09-15T14:00:00Z"), end: new Date("2026-09-15T15:00:00Z") },
    { start: new Date("2026-09-15T14:30:00Z"), end: new Date("2026-09-15T16:00:00Z") },
    { start: new Date("2026-09-15T18:00:00Z"), end: new Date("2026-09-15T19:00:00Z") },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(new Date(merged[0].end).toISOString(), "2026-09-15T16:00:00.000Z");
});

test("overlapping weekly rules are merged before slotting", () => {
  const windows = windowsForDate(
    DateTime.fromISO("2026-09-15", { zone: TZ }),
    [
      { dayOfWeek: 2, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 2, startMinute: 660, endMinute: 900 },
    ],
    [],
  );
  assert.deepEqual(windows, [{ startMinute: 540, endMinute: 900 }]);
});

test("slots stay on the clock on both DST transition days", () => {
  // US DST 2027: forward Sunday 14 March, back Sunday 7 November. Those local
  // days are 23 and 25 hours long, which is where naive minute arithmetic slips.
  const rulesEveryDay = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  }));

  for (const day of ["2027-03-14", "2027-11-07"]) {
    const slots = computeSlots({
      ...baseRequest,
      rules: rulesEveryDay,
      rangeStart: local(`${day}T00:00`),
      rangeEnd: local(`${day}T23:59`),
      now: local("2027-01-01T08:00"),
    });
    const times = labels(slots);
    assert.equal(times[0].slice(4), "09:00", `${day} should open at 09:00`);
    assert.equal(times.at(-1)!.slice(4), "16:30", `${day} should close by 17:00`);
  }
});
