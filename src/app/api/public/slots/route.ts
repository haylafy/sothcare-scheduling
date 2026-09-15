import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { slotQuerySchema } from "@/lib/validation";
import { loadEventType, getAvailableSlots } from "@/lib/bookings";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/public/slots — open times for one event type in a date range. */
export async function GET(request: Request) {
  // Each call can fan out to a Google free/busy query per connected calendar.
  const limit = rateLimit(`slots:${clientIp(request)}`, 120, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const url = new URL(request.url);
  const parsed = slotQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { host, event, from, to, timezone } = parsed.data;

  const eventType = await loadEventType(host, event);
  if (!eventType) return NextResponse.json({ error: "Event type not found" }, { status: 404 });

  const rangeStart = DateTime.fromISO(from, { zone: timezone }).startOf("day");
  const rangeEnd = DateTime.fromISO(to, { zone: timezone }).endOf("day");
  if (!rangeStart.isValid || !rangeEnd.isValid) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  // Cap the window so a crafted request cannot ask for ten years of slots.
  const cappedEnd = DateTime.min(rangeEnd, rangeStart.plus({ days: 62 }));

  const slots = await getAvailableSlots(eventType, {
    from: rangeStart.toJSDate(),
    to: cappedEnd.toJSDate(),
  });

  const days: Record<string, string[]> = {};
  for (const slot of slots) {
    const key = DateTime.fromJSDate(slot.start).setZone(timezone).toISODate()!;
    (days[key] ||= []).push(slot.start.toISOString());
  }

  return NextResponse.json({
    event: {
      title: eventType.title,
      durationMinutes: eventType.durationMinutes,
      seatsPerSlot: eventType.seatsPerSlot,
    },
    days,
  });
}
