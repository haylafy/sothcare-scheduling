import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { cancelBooking } from "@/lib/bookings";
import BrandShell from "@/components/BrandShell";
import { BASE_PATH } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function CancelPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const booking = await prisma.booking.findUnique({
    where: { uid },
    include: { host: true, eventType: true },
  });
  if (!booking) notFound();
  if (booking.status === "CANCELLED") redirect(`${BASE_PATH()}/booking/${uid}`);

  async function confirmCancel(formData: FormData) {
    "use server";
    await cancelBooking(uid, "invitee", String(formData.get("reason") ?? "") || undefined);
    redirect(`${BASE_PATH()}/booking/${uid}`);
  }

  const start = DateTime.fromJSDate(booking.startsAt).setZone(booking.inviteeTimezone);

  return (
    <BrandShell host={booking.host}>
      <div className="card mx-auto max-w-lg p-8">
        <h1 className="text-xl font-bold text-slate-900">Cancel this booking?</h1>
        <p className="mt-2 text-sm text-slate-600">
          {booking.eventType.title} with {booking.host.name} on{" "}
          {start.toFormat("cccc, LLLL d 'at' h:mm a ZZZZ")}.
        </p>

        <form action={confirmCancel} className="mt-6 space-y-4">
          <label className="block text-xs font-medium text-slate-600">
            Reason (optional — shared with {booking.host.name})
            <textarea
              name="reason"
              rows={3}
              className="brand-ring mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Cancel booking
          </button>
        </form>
      </div>
    </BrandShell>
  );
}
