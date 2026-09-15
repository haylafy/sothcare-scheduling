import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { hostCancelBooking, confirmBooking, setBookingAttendance } from "./actions";
import { Card, Button } from "@/components/form";
import { describeLocation } from "@/lib/templates";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile for this account yet.</p>;

  const now = new Date();
  const [upcoming, past] = await Promise.all([
    prisma.booking.findMany({
      where: { hostId: host.id, status: { in: ["CONFIRMED", "PENDING"] }, endsAt: { gte: now } },
      include: { eventType: true },
      orderBy: { startsAt: "asc" },
      take: 50,
    }),
    prisma.booking.findMany({
      where: { hostId: host.id, endsAt: { lt: now } },
      include: { eventType: true },
      orderBy: { startsAt: "desc" },
      take: 15,
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Bookings</h1>
        <p className="text-sm text-slate-500">
          {upcoming.length} upcoming · times shown in {host.timezone.replace(/_/g, " ")}
        </p>
      </header>

      <Card title="Upcoming">
        {upcoming.length === 0 && <p className="text-sm text-slate-500">Nothing booked yet.</p>}
        <ul className="divide-y divide-slate-100">
          {upcoming.map((booking) => {
            const start = DateTime.fromJSDate(booking.startsAt).setZone(host.timezone);
            return (
              <li key={booking.id} className="flex flex-wrap items-center gap-4 py-3">
                <div className="w-36 shrink-0">
                  <p className="text-sm font-semibold text-slate-900">{start.toFormat("ccc, LLL d")}</p>
                  <p className="text-xs text-slate-500">{start.toFormat("h:mm a")}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {booking.eventType.title} — {booking.inviteeName}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {booking.inviteeEmail} · {describeLocation(booking)}
                  </p>
                </div>
                {booking.status === "PENDING" && (
                  <form action={confirmBooking}>
                    <input type="hidden" name="uid" value={booking.uid} />
                    <Button variant="primary">Confirm</Button>
                  </form>
                )}
                <form action={hostCancelBooking}>
                  <input type="hidden" name="uid" value={booking.uid} />
                  <Button variant="danger">Cancel</Button>
                </form>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        title="Recent"
        description="Mark attendance to gate no-show / attended-only follow-up sequences (Workflows)."
      >
        {past.length === 0 && <p className="text-sm text-slate-500">No past bookings.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {past.map((booking) => (
            <li key={booking.id} className="flex flex-wrap items-center gap-4 py-2 text-slate-600">
              <span className="w-36 shrink-0 text-xs">
                {DateTime.fromJSDate(booking.startsAt).setZone(host.timezone).toFormat("LLL d, h:mm a")}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {booking.eventType.title} — {booking.inviteeName}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  booking.status === "CANCELLED"
                    ? "bg-red-50 text-red-600"
                    : booking.status === "RESCHEDULED"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                }`}
              >
                {booking.status.toLowerCase()}
              </span>
              {booking.status === "CONFIRMED" &&
                (booking.attendanceStatus === "UNKNOWN" ? (
                  <div className="flex gap-2">
                    <form action={setBookingAttendance}>
                      <input type="hidden" name="uid" value={booking.uid} />
                      <input type="hidden" name="status" value="ATTENDED" />
                      <button className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700 hover:bg-teal-100">
                        Attended
                      </button>
                    </form>
                    <form action={setBookingAttendance}>
                      <input type="hidden" name="uid" value={booking.uid} />
                      <input type="hidden" name="status" value="NO_SHOW" />
                      <button className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                        No-show
                      </button>
                    </form>
                  </div>
                ) : (
                  <form action={setBookingAttendance}>
                    <input type="hidden" name="uid" value={booking.uid} />
                    <input type="hidden" name="status" value="UNKNOWN" />
                    <button
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        booking.attendanceStatus === "NO_SHOW"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-teal-100 text-teal-800"
                      }`}
                      title="Click to unmark"
                    >
                      {booking.attendanceStatus === "NO_SHOW" ? "No-show ✕" : "Attended ✕"}
                    </button>
                  </form>
                ))}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
