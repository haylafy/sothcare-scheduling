import { NextResponse } from "next/server";
import { bookingSchema } from "@/lib/validation";
import { loadEventType, createBooking, SlotUnavailableError } from "@/lib/bookings";
import { publicUrl } from "@/lib/env";
import { sanitizeRedirectUrl } from "@/lib/url-safety";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/public/book — create a booking from the public booking page. */
export async function POST(request: Request) {
  // This endpoint creates rows, writes calendar events and sends mail from our
  // domain, so it is worth abusing.
  const limit = rateLimit(`book:${clientIp(request)}`, 10, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const data = parsed.data;

  const eventType = await loadEventType(data.host, data.event);
  if (!eventType) return NextResponse.json({ error: "Event type not found" }, { status: 404 });

  // The form can be bypassed, so everything it enforces is re-checked here.
  if (eventType.locationType === "PHONE_HOST_CALLS" && !data.phone?.trim()) {
    return NextResponse.json({ error: "A phone number is required for this meeting" }, { status: 400 });
  }

  // Required custom questions are enforced server-side too.
  for (const question of eventType.questions) {
    if (!question.required) continue;
    const answer = data.answers?.[question.id];
    const empty =
      answer === undefined ||
      answer === "" ||
      answer === false ||
      (Array.isArray(answer) && answer.length === 0);
    if (empty) {
      return NextResponse.json({ error: `"${question.label}" is required` }, { status: 400 });
    }
  }

  try {
    const booking = await createBooking({
      eventType,
      start: new Date(data.start),
      inviteeName: data.name,
      inviteeEmail: data.email,
      inviteeTimezone: data.timezone,
      inviteePhone: data.phone || undefined,
      inviteeNotes: data.notes || undefined,
      guestEmails: data.guests ?? [],
      answers: data.answers ?? {},
    });

    return NextResponse.json({
      uid: booking.uid,
      status: booking.status,
      redirectUrl:
        sanitizeRedirectUrl(eventType.redirectUrl) ?? publicUrl(`/booking/${booking.uid}`),
    });
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[book] failed", error);
    return NextResponse.json({ error: "Could not complete the booking" }, { status: 500 });
  }
}
