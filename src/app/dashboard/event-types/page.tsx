import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { createEventType, deleteEventType } from "../actions";
import { Card, TextInput, TextArea, Button } from "@/components/form";
import { BASE_PATH, APP_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function EventTypesPage() {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile yet.</p>;

  const eventTypes = await prisma.eventType.findMany({
    where: { hostId: host.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { bookings: true } } },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Event types</h1>
        <p className="text-sm text-slate-500">
          Create as many as you need — there is no cap. Each gets its own link.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {eventTypes.map((event) => (
          <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: event.color }} />
                  <h2 className="truncate font-semibold text-slate-900">{event.title}</h2>
                  {!event.isActive && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">off</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {event.durationMinutes} min · {event._count.bookings} bookings
                </p>
                <p className="mt-2 truncate text-xs text-slate-400">
                  {APP_URL()}
                  {BASE_PATH()}/book/{host.slug}/{event.slug}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Link
                href={`${BASE_PATH()}/dashboard/event-types/${event.id}`}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700"
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
        ))}
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
