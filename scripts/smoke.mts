/**
 * End-to-end check against a real Postgres: availability -> booking ->
 * double-book rejection -> reminders queued -> reschedule -> cancel.
 *
 *   npm run db:seed && npx tsx scripts/smoke.ts
 */
process.loadEnvFile(".env");

const { DateTime } = await import("luxon");
const { prisma } = await import("../src/lib/prisma");
const { loadEventType, getAvailableSlots, createBooking, cancelBooking, rescheduleBooking, SlotUnavailableError } =
  await import("../src/lib/bookings");
const { processDueWorkflowRuns } = await import("../src/lib/workflows");

function check(label: string, condition: unknown) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

const eventType = await loadEventType("salmaan", "20-min-demo");
if (!eventType) throw new Error("Seed first: npm run db:seed");

// Clean up anything a previous run left behind.
await prisma.booking.deleteMany({ where: { inviteeEmail: "smoke@example.com" } });

const from = DateTime.now().plus({ days: 3 }).startOf("day").toJSDate();
const to = DateTime.now().plus({ days: 10 }).endOf("day").toJSDate();

console.log("\n1. Availability");
const slots = await getAvailableSlots(eventType, { from, to, skipExternal: true });
check(`returned ${slots.length} open slots`, slots.length > 0);
check(
  "every slot is 20 minutes",
  slots.every((s) => s.end.getTime() - s.start.getTime() === 20 * 60000),
);
check(
  "no slot starts before 09:00 Central",
  slots.every((s) => DateTime.fromJSDate(s.start).setZone("America/Chicago").hour >= 9),
);

console.log("\n2. Booking");
const target = slots[10];
const booking = await createBooking({
  eventType,
  start: target.start,
  inviteeName: "Smoke Test",
  inviteeEmail: "smoke@example.com",
  inviteeTimezone: "America/New_York",
  inviteeNotes: "Two group homes in Robbinsdale.",
  answers: { [eventType.questions[0].id]: "245D" },
  skipExternal: true,
});
check(`created booking ${booking.uid}`, booking.status === "CONFIRMED");
check("answers stored", JSON.stringify(booking.answers).includes("245D"));

console.log("\n3. The slot is gone and cannot be double-booked");
const after = await getAvailableSlots(eventType, { from, to, skipExternal: true });
check("slot removed from availability", !after.some((s) => s.start.getTime() === target.start.getTime()));
check(
  "buffer also cleared the following slot",
  !after.some((s) => s.start.getTime() === target.start.getTime() + 20 * 60000),
);

let rejected = false;
try {
  await createBooking({
    eventType,
    start: target.start,
    inviteeName: "Second Person",
    inviteeEmail: "smoke@example.com",
    inviteeTimezone: "UTC",
    skipExternal: true,
  });
} catch (error) {
  rejected = error instanceof SlotUnavailableError;
}
check("a second booking for the same time is refused", rejected);

console.log("\n4. Reminders queued");
const runs = await prisma.workflowRun.findMany({
  where: { bookingId: booking.id },
  include: { workflow: true },
  orderBy: { scheduledFor: "asc" },
});
check(`${runs.length} workflow runs scheduled`, runs.length >= 3);
const reminder24 = runs.find((r) => r.workflow.offsetMinutes === 1440);
check(
  "the 24-hour reminder is queued for exactly 24h before the meeting",
  reminder24 &&
    Math.abs(reminder24.scheduledFor.getTime() - (booking.startsAt.getTime() - 1440 * 60000)) < 1000,
);
const due = await processDueWorkflowRuns();
check("nothing is due yet", due.sent === 0);

console.log("\n5. Reschedule");
// Deliberately the slot right next to the original: the booking being moved
// must not block (via its own buffer) the time it is moving to.
const adjacent = slots.find((s) => s.start.getTime() === target.start.getTime() + 30 * 60000)!;
check("an adjacent slot exists to move into", Boolean(adjacent));
const newSlot = adjacent;
const moved = await rescheduleBooking(booking.uid, newSlot.start, { skipExternal: true });
check("new booking created", moved !== null && moved.uid !== booking.uid);
const original = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
check("original marked RESCHEDULED", original.status === "RESCHEDULED");
check("original reminders cancelled", (await prisma.workflowRun.count({ where: { bookingId: booking.id, status: "PENDING" } })) === 0);
check("invitee details carried over", moved!.inviteeEmail === "smoke@example.com");

console.log("\n6. Cancel");
const cancelled = await cancelBooking(moved!.uid, "invitee", "Something came up");
check("status is CANCELLED", cancelled?.status === "CANCELLED");
check(
  "time is bookable again",
  (await getAvailableSlots(eventType, { from, to, skipExternal: true })).some(
    (s) => s.start.getTime() === newSlot.start.getTime(),
  ),
);

console.log("\n7. Notification log");
const log = await prisma.notificationLog.findMany({
  where: { booking: { inviteeEmail: "smoke@example.com" } },
  orderBy: { createdAt: "asc" },
});
check(`${log.length} emails recorded`, log.length >= 4);
check("all sends succeeded", log.every((l) => l.success));
console.log(log.map((l) => `      - ${l.kind}: "${l.subject}" -> ${l.to}`).join("\n"));

console.log("\nAll smoke checks passed.\n");
await prisma.$disconnect();
