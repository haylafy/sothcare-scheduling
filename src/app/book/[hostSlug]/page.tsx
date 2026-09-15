import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import BrandShell from "@/components/BrandShell";
import { BASE_PATH } from "@/lib/env";

export const dynamic = "force-dynamic";

/** The host's public page: every event type they offer. */
export default async function HostPage({ params }: { params: Promise<{ hostSlug: string }> }) {
  const { hostSlug } = await params;
  const host = await prisma.host.findUnique({
    where: { slug: hostSlug },
    include: {
      eventTypes: {
        where: { isActive: true, isHidden: false },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!host || !host.isActive) notFound();

  return (
    <BrandShell host={host}>
      <header className="mb-8 text-center">
        {host.avatarUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={host.avatarUrl}
            alt=""
            className="mx-auto mb-4 h-16 w-16 rounded-full object-cover"
          />
        )}
        <h1 className="text-2xl font-bold text-slate-900">{host.headline || host.name}</h1>
        {host.welcomeText && (
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">{host.welcomeText}</p>
        )}
      </header>

      <div className="space-y-3">
        {host.eventTypes.length === 0 && (
          <p className="card p-6 text-center text-sm text-slate-500">
            No meeting types are published yet.
          </p>
        )}
        {host.eventTypes.map((event) => (
          <Link
            key={event.id}
            href={`${BASE_PATH()}/book/${host.slug}/${event.slug}`}
            className="card flex items-center justify-between gap-4 p-5 transition hover:shadow-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: event.color }}
                />
                <h2 className="truncate font-semibold text-slate-900">{event.title}</h2>
              </div>
              {event.description && (
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{event.description}</p>
              )}
              <p className="mt-1 text-xs font-medium text-slate-400">
                {event.durationMinutes} min
              </p>
            </div>
            <span className="brand-text shrink-0 text-sm font-semibold">Book →</span>
          </Link>
        ))}
      </div>
    </BrandShell>
  );
}
