import { NextResponse } from "next/server";
import { cancelSchema } from "@/lib/validation";
import { cancelBooking } from "@/lib/bookings";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ uid: string }> }) {
  const limit = rateLimit(`cancel:${clientIp(request)}`, 20, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const { uid } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const parsed = cancelSchema.safeParse(body);
  const booking = await cancelBooking(uid, "invitee", parsed.success ? parsed.data.reason : undefined);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status: booking.status });
}
