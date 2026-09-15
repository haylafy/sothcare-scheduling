import { NextResponse } from "next/server";
import { rescheduleSchema } from "@/lib/validation";
import { rescheduleBooking, SlotUnavailableError } from "@/lib/bookings";
import { publicUrl } from "@/lib/env";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ uid: string }> }) {
  const limit = rateLimit(`reschedule:${clientIp(request)}`, 10, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const { uid } = await ctx.params;
  const parsed = rescheduleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "A new start time is required" }, { status: 400 });

  try {
    const booking = await rescheduleBooking(uid, new Date(parsed.data.start));
    if (!booking) {
      return NextResponse.json(
        { error: "That booking has already been moved or cancelled." },
        { status: 409 },
      );
    }
    return NextResponse.json({ uid: booking.uid, redirectUrl: publicUrl(`/booking/${booking.uid}`) });
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
