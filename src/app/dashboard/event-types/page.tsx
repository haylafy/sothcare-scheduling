import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { createEventType, deleteEventType, toggleEventType } from "../actions";
import { Card, TextInput, TextArea, Button } from "@/components/form";
import CopyLinkButton from "@/components/CopyLinkButton";
import { BASE_PATH, APP_URL } from "@/lib/env";
import { LOCATION_LABELS } from "@/lib/locations";

export const dynamic = "force-dynamic";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon, Tue, Wed, Thu, Fri" from a schedule's weekly rules. */
function describeDays(rules: Array<{ dayOfWeek: number }>) {
  const days = [...new Set(rules.map((r) => r.dayOfWeek))].sort((a, b) => a - b);
  if (days.length === 0) return "No hours set";
  return days.map((d) => DAY_SHORT[d]).join(", ");
}

export default async function EventTypesPage() {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile yet.</p>;

  const [eventTypes, defaultSchedule] = await Promise.all([
    prisma.eventType.findMany({
      where: { hostId: host.id },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { bookings: true } },
        schedule: { include: { rules: { select: { dayOfWeek: true } } } },
      },
    }),
    prisma.schedule.findFirst({
      where: { hostId: host.id, isDefault: true },
      include: { rules: { select: { dayOfWeek: true } } },
    }),
  ]);

  const publicBase = `${APP_URL()}${BASE_PATH()}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Event types</h1>
        <p className="text-sm text-slate-500">
          Create as many as you need — there is no cap. Each gets its own link.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {eventTypes.map((event) => {
          const rules = event.schedule?.rules ?? defaultSchedule?.rules ?? [];
          const link = `${publicBase}/book/${host.slug}/${event.slug}`;
          return (
            <div
              key={event.id}
              className={`rounded-xl border bg-white p-5 ${
                event.isActive ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-80"
              }`}
              style={{ borderLeftWidth: 4, borderLeftColor: event.isActive ? event.color : "#CBD5E1" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold text-slate-900">{event.title}</h2>
                    {!event.isActive && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">off</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {event.durationMinutes} min · {LOCATION_LABELS[event.locationType]} ·{" "}
                    {event.seatsPerSlot > 1 ? `Group (${event.seatsPerSlot})` : "One-on-one"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {describeDays(rules)} · {event._count.bookings} booking{event._count.bookings === 1 ? "" : "s"}
                  </p>
                  <p className="mt-2 truncate text-xs text-slate-400">{link}</p>
                </div>
                <form action={toggleEventType} className="shrink-0">
                  <input type="hidden" name="id" value={event.id} />
                  <Button variant="ghost">{event.isActive ? "Turn off" : "Turn on"}</Button>
                </form>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <CopyLinkButton url={link} />
                <Link
                  href={`${BASE_PATH()}/dashboard/event-types/${event.id}`}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Edit
                </Link>
                <a
                  href={`${BASE_PATH()}/book/${host.slug}/${event.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-teal-700"
                >
                  Preview ↗
                </a>
                <form action={deleteEventType} className="ml-auto">
                  <input type="hidden" name="id" value={event.id} />
                  <Button variant="danger">Delete</Button>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      <Card title="New event type">
        <form action={createEventType} className="grid gap-4 md:grid-cols-2">
          <TextInput name="title" label="Name" placeholder="Sothcare 20-min demo" required />
          <TextInput name="durationMinutes" label="Duration (minutes)" type="number" defaultValue={30} min={5} />
          <div className="md:col-span-2">
            <TextArea name="description" label="Description" rows={3} />
          </div>
          <div className="md:col-span-2">
            <Button>Create event type</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
