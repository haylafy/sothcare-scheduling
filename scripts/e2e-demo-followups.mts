/**
 * End-to-end check for the demo follow-up emails, against a local database
 * with MAIL_TRANSPORT=log. Prints every email the run would have sent.
 *
 *   npm run e2e:followups
 *
 * Covers the four things that actually matter and cannot be proved by a unit
 * test: the run is queued an hour after the MARK, a second cron tick does not
 * re-send, changing the outcome before the send swaps which email goes out,
 * and a booking before the cutoff is never followed up.
 *
 * Destructive: it deletes its own fixtures on the way in and out. Point it at
 * a scratch database, never at anything you care about.
 */
try {
  process.loadEnvFile(".env");
} catch {
  /* optional */
}

const { prisma } = await import("../src/lib/prisma");
const { processDueWorkflowRuns } = await import("../src/lib/workflows");
const { markAttendance } = await import("../src/lib/bookings");
const { DEMO_FOLLOWUP_OFFSET_MINUTES } = await import("../src/lib/demo-followups");

const TAG = "e2e-followup";
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

async function cleanup() {
  const bookings = await prisma.booking.findMany({
    where: { inviteeEmail: { contains: TAG } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  if (ids.length) {
    await prisma.workflowRun.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.notificationLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
}

async function makeBooking(name: string, startsAt: Date, inviteeName: string) {
  const eventType = await prisma.eventType.findFirstOrThrow({ include: { host: true } });
  return prisma.booking.create({
    data: {
      uid: `${TAG}-${name}-${Date.now()}`,
      organizationId: eventType.host.organizationId,
      hostId: eventType.hostId,
      eventTypeId: eventType.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 20 * 60000),
      timezone: "America/New_York",
      inviteeName,
      inviteeEmail: `${TAG}+${name}@example.test`,
      inviteeTimezone: "America/New_York",
      locationType: eventType.locationType,
    },
  });
}

const runFor = (bookingId: string) =>
  prisma.workflowRun.findMany({
    where: { bookingId },
    include: { workflow: { select: { name: true, condition: true, trigger: true } } },
  });

/** Pull the run's scheduled moment back into the past so cron picks it up. */
async function fastForward(bookingId: string) {
  await prisma.workflowRun.updateMany({
    where: { bookingId, status: "PENDING" },
    data: { scheduledFor: new Date(Date.now() - 60_000) },
  });
}

await cleanup();

const AFTER_CUTOFF = new Date("2026-09-30T15:00:00.000Z");
const BEFORE_CUTOFF = new Date("2026-09-21T14:00:00.000Z");

console.log("\n=== 1. Attended: queued one hour after the MARK ===");
{
  const b = await makeBooking("attended", AFTER_CUTOFF, "esther adebanjo");
  const before = Date.now();
  await markAttendance(b.uid, "ATTENDED");
  const runs = (await runFor(b.id)).filter((r) => r.workflow.trigger === "AFTER_ATTENDANCE_MARKED");
  check("exactly one run queued", runs.length, 1);
  check("it is the attended workflow", runs[0]?.workflow.condition, "ATTENDED_ONLY");
  check("status PENDING", runs[0]?.status, "PENDING");
  const delayMin = Math.round(((runs[0]!.scheduledFor.getTime() - before) / 60000));
  check(`scheduled ~${DEMO_FOLLOWUP_OFFSET_MINUTES} min out`, delayMin, DEMO_FOLLOWUP_OFFSET_MINUTES);

  console.log("\n  -- cron tick (nothing due yet) --");
  check("nothing sent before the hour is up", (await processDueWorkflowRuns()).sent, 0);

  console.log("\n  -- an hour passes --");
  await fastForward(b.id);
  const first = await processDueWorkflowRuns();
  check("one email sent", first.sent, 1);

  console.log("\n  -- cron runs again (overlap / retry) --");
  const second = await processDueWorkflowRuns();
  check("no second send", second.sent, 0);
  const sent = await prisma.notificationLog.count({ where: { bookingId: b.id, success: true } });
  check("exactly one successful send on record", sent, 1);
}

console.log("\n=== 2. Changing the outcome before it goes out ===");
{
  const b = await makeBooking("switch", AFTER_CUTOFF, "mary ann smith");
  await markAttendance(b.uid, "ATTENDED");
  await markAttendance(b.uid, "NO_SHOW");
  const runs = (await runFor(b.id)).filter((r) => r.workflow.trigger === "AFTER_ATTENDANCE_MARKED");
  const pending = runs.filter((r) => r.status === "PENDING");
  check("one run still pending", pending.length, 1);
  check("and it is the no-show one", pending[0]?.workflow.condition, "NO_SHOW_ONLY");
  check(
    "the attended run was cancelled, not left queued",
    runs.find((r) => r.workflow.condition === "ATTENDED_ONLY")?.status ?? "absent",
    "CANCELLED",
  );
  await fastForward(b.id);
  check("one email sent", (await processDueWorkflowRuns()).sent, 1);
}

console.log("\n=== 3. Unmarking retires the pending run ===");
{
  const b = await makeBooking("unmark", AFTER_CUTOFF, "jo");
  await markAttendance(b.uid, "NO_SHOW");
  await markAttendance(b.uid, "UNKNOWN");
  const pending = (await runFor(b.id)).filter(
    (r) => r.workflow.trigger === "AFTER_ATTENDANCE_MARKED" && r.status === "PENDING",
  );
  check("nothing left queued", pending.length, 0);
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  check("attendanceSetAt cleared", booking.attendanceSetAt, null);
}

console.log("\n=== 4. A booking before the Sept 28 cutoff ===");
{
  const b = await makeBooking("old", BEFORE_CUTOFF, "old prospect");
  await markAttendance(b.uid, "ATTENDED");
  const pending = (await runFor(b.id)).filter(
    (r) => r.workflow.trigger === "AFTER_ATTENDANCE_MARKED" && r.status === "PENDING",
  );
  check("never queued", pending.length, 0);
  await fastForward(b.id);
  check("and nothing sent", (await processDueWorkflowRuns()).sent, 0);
}

console.log("\n=== emails this run would have sent ===");
const logs = await prisma.notificationLog.findMany({
  where: { booking: { inviteeEmail: { contains: TAG } } },
  orderBy: { createdAt: "asc" },
  include: { booking: { select: { inviteeName: true, attendanceStatus: true } } },
});
for (const l of logs) {
  console.log(
    `\n  to:      ${l.to}\n  subject: ${l.subject}\n  kind:    ${l.kind}` +
      `\n  outcome: ${l.booking?.attendanceStatus}  (invitee "${l.booking?.inviteeName}")` +
      `\n  success: ${l.success}${l.error ? `  error: ${l.error}` : ""}`,
  );
}

await cleanup();
await prisma.$disconnect();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
