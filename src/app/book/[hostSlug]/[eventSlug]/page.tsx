import { notFound } from "next/navigation";
import { loadEventType } from "@/lib/bookings";
import BrandShell from "@/components/BrandShell";
import BookingFlow from "@/components/BookingFlow";
import { BASE_PATH } from "@/lib/env";
import { LOCATION_LABELS, VIDEO_LINK_LOCATIONS } from "@/lib/locations";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hostSlug: string; eventSlug: string }>;
}) {
  const { hostSlug, eventSlug } = await params;
  const eventType = await loadEventType(hostSlug, eventSlug);
  if (!eventType) return { title: "Not found" };
  return {
    title: `${eventType.title} — ${eventType.host.name}`,
    description: eventType.description ?? undefined,
  };
}

export default async function BookingPage({
  params,
}: {
  params: Promise<{ hostSlug: string; eventSlug: string }>;
}) {
  const { hostSlug, eventSlug } = await params;
  const eventType = await loadEventType(hostSlug, eventSlug);
  if (!eventType) notFound();

  // A Zoom/Teams locationValue is the join link -- only people who book get it.
  const location = VIDEO_LINK_LOCATIONS.has(eventType.locationType)
    ? LOCATION_LABELS[eventType.locationType]
    : (eventType.locationValue ?? LOCATION_LABELS[eventType.locationType]);

  return (
    <BrandShell host={eventType.host}>
      <div className="card overflow-hidden">
        <div className="grid md:grid-cols-[minmax(0,15rem)_1fr]">
          {/* Meeting summary */}
          <aside className="border-b border-slate-200 p-6 md:border-b-0 md:border-r">
            {eventType.host.avatarUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={eventType.host.avatarUrl}
                alt=""
                className="mb-3 h-12 w-12 rounded-full object-cover"
              />
            )}
            <p className="text-sm font-medium text-slate-500">{eventType.host.name}</p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">{eventType.title}</h1>

            <dl className="mt-4 space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <span aria-hidden>🕑</span>
                <span>{eventType.durationMinutes} minutes</span>
              </div>
              <div className="flex items-start gap-2">
                <span aria-hidden>📍</span>
                <span>{location}</span>
              </div>
              {eventType.seatsPerSlot > 1 && (
                <div className="flex items-center gap-2">
                  <span aria-hidden>👥</span>
                  <span>Up to {eventType.seatsPerSlot} attendees per session</span>
                </div>
              )}
            </dl>

            {eventType.description && (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {eventType.description}
              </p>
            )}
          </aside>

          {/* Date / time / details */}
          <div className="p-6">
            <BookingFlow
              basePath={BASE_PATH()}
              hostSlug={hostSlug}
              eventSlug={eventSlug}
              eventTitle={eventType.title}
              durationMinutes={eventType.durationMinutes}
              locationLabel={location}
              askPhone={eventType.locationType === "PHONE_HOST_CALLS"}
              questions={eventType.questions.map((q) => ({
                id: q.id,
                label: q.label,
                helpText: q.helpText,
                type: q.type,
                required: q.required,
                options: q.options,
              }))}
            />
          </div>
        </div>
      </div>
    </BrandShell>
  );
}
