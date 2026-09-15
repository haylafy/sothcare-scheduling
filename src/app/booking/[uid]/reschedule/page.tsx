import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import BrandShell from "@/components/BrandShell";
import BookingFlow from "@/components/BookingFlow";
import { BASE_PATH } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ReschedulePage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const booking = await prisma.booking.findUnique({
    where: { uid },
    include: {
      host: true,
      eventType: { include: { questions: { orderBy: { position: "asc" } } } },
    },
  });
  if (!booking) notFound();
  if (booking.status === "CANCELLED") redirect(`${BASE_PATH()}/booking/${uid}`);

  const start = DateTime.fromJSDate(booking.startsAt).setZone(booking.inviteeTimezone);

  return (
    <BrandShell host={booking.host}>
      <div className="card p-6">
        <p className="text-sm text-slate-500">
          Currently scheduled for{" "}
          <strong className="text-slate-800">{start.toFormat("cccc, LLLL d 'at' h:mm a ZZZZ")}</strong>
        </p>
        <h1 className="mt-1 mb-5 text-xl font-bold text-slate-900">
          Pick a new time for {booking.eventType.title}
        </h1>

        <BookingFlow
          basePath={BASE_PATH()}
          hostSlug={booking.host.slug}
          eventSlug={booking.eventType.slug}
          eventTitle={booking.eventType.title}
          durationMinutes={booking.eventType.durationMinutes}
          locationLabel=""
          askPhone={false}
          questions={[]}
          rescheduleUid={booking.uid}
        />
      </div>
    </BrandShell>
  );
}
