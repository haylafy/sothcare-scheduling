import Link from "next/link";
import { getCurrentHost } from "@/lib/auth";
import { BASE_PATH } from "@/lib/env";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/dashboard", label: "Bookings" },
  { href: "/dashboard/event-types", label: "Event types" },
  { href: "/dashboard/availability", label: "Availability" },
  { href: "/dashboard/calendars", label: "Calendars" },
  { href: "/dashboard/workflows", label: "Workflows" },
  { href: "/dashboard/integrations", label: "Integrations" },
  { href: "/dashboard/branding", label: "Booking page" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const host = await getCurrentHost();
  const base = BASE_PATH();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="font-bold text-slate-900">Scheduling</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={`${base}${item.href}`}
                className="text-slate-600 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {host && (
            <a
              href={`${base}/book/${host.slug}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-sm font-semibold text-teal-700 hover:underline"
            >
              View booking page ↗
            </a>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
