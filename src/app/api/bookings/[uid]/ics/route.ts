import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildIcs } from "@/lib/ics";
import { describeLocation } from "@/lib/templates";
import { publicUrl } from "@/lib/env";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/bookings/<uid>/ics — the same invite that is attached to the
 * confirmation email, as a download. Backs the "Apple / .ics" chip in emails
 * for clients that strip attachments or render them badly.
 */
export async function GET(request: Request, ctx: { params: Promise<{ uid: string }> }) {
  const limit = rateLimit(`ics:${clientIp(request)}`, 60, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const { uid } = await ctx.params;
  const booking = await prisma.booking.findUnique({
    where: { uid },
    include: { eventType: true, host: true },
  });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const cancelled = booking.status === "CANCELLED";
  const ics = buildIcs({
    uid: `${booking.uid}@sothcare.com`,
    method: cancelled ? "CANCEL" : "REQUEST",
    sequence: booking.rescheduledFromId ? 1 : 0,
    cancelled,
    summary: `${booking.eventType.title} — ${booking.host.name}`,
    description: describeLocation(booking),
    location: describeLocation(booking),
    start: booking.startsAt,
    end: booking.endsAt,
    organizer: { name: booking.host.name, email: booking.host.email },
    attendees: [{ name: booking.inviteeName, email: booking.inviteeEmail }],
    url: publicUrl(`/booking/${booking.uid}`),
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "content-type": `text/calendar; method=${cancelled ? "CANCEL" : "REQUEST"}; charset=utf-8`,
      "content-disposition": `attachment; filename="${cancelled ? "cancelled" : "invite"}.ics"`,
      "cache-control": "no-store",
    },
  });
}
