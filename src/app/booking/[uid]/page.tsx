import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import BrandShell from "@/components/BrandShell";
import { describeLocation } from "@/lib/templates";
import { BASE_PATH } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function BookingDetail({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const booking = await prisma.booking.findUnique({
    where: { uid },
    include: { host: true, eventType: true },
  });
  if (!booking) notFound();

  const start = DateTime.fromJSDate(booking.startsAt).setZone(booking.inviteeTimezone);
  const cancelled = booking.status === "CANCELLED";
  const past = booking.endsAt.getTime() < Date.now();

  return (
    <BrandShell host={booking.host}>
      <div className="card mx-auto max-w-lg p-8 text-center">
        <div
          className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full text-xl"
          style={{
            background: cancelled ? "#FEE2E2" : "color-mix(in srgb, var(--brand) 14%, #fff)",
            color: cancelled ? "#B91C1C" : "var(--brand)",
          }}
          aria-hidden
        >
          {cancelled ? "✕" : "✓"}
        </div>

        <h1 className="text-xl font-bold text-slate-900">
          {cancelled
            ? "This booking was cancelled"
            : booking.status === "PENDING"
              ? "Request sent"
              : "You're scheduled"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {cancelled
            ? "Nothing is on the calendar for this time."
            : booking.status === "PENDING"
              ? `${booking.host.name} will confirm shortly. A calendar invite follows on confirmation.`
              : `A calendar invite is on its way to ${booking.inviteeEmail}.`}
        </p>

        <dl className="mt-6 space-y-3 border-t border-slate-200 pt-6 text-left text-sm">
          <Row label="Event">{booking.eventType.title}</Row>
          <Row label="With">{booking.host.name}</Row>
          <Row label="When">
            {start.toFormat("cccc, LLLL d, yyyy")}
            <br />
            {start.toFormat("h:mm a")} –{" "}
            {DateTime.fromJSDate(booking.endsAt).setZone(booking.inviteeTimezone).toFormat("h:mm a ZZZZ")}
          </Row>
          <Row label="Where">{describeLocation(booking) || "—"}</Row>
          {booking.inviteeNotes && <Row label="Notes">{booking.inviteeNotes}</Row>}
        </dl>

        {!cancelled && !past && (
          <div className="mt-6 flex justify-center gap-3 text-sm font-semibold">
            <Link
              href={`${BASE_PATH()}/booking/${booking.uid}/reschedule`}
              className="brand-text rounded-lg border border-slate-200 px-4 py-2"
            >
              Reschedule
            </Link>
            <Link
              href={`${BASE_PATH()}/booking/${booking.uid}/cancel`}
              className="rounded-lg border border-slate-200 px-4 py-2 text-slate-600"
            >
              Cancel
            </Link>
          </div>
        )}
      </div>
    </BrandShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}
