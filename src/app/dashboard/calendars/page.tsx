import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { setCalendarFlags, disconnectCalendarAccount, setInviteAttendees } from "../actions";
import { Card, Button, Toggle } from "@/components/form";
import { BASE_PATH } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function CalendarsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile yet.</p>;
  const { connected, error } = await searchParams;

  const accounts = await prisma.calendarAccount.findMany({
    where: { hostId: host.id },
    include: { calendars: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } },
    orderBy: { createdAt: "asc" },
  });

  const configured = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Connected calendars</h1>
        <p className="text-sm text-slate-500">
          Connect every calendar that holds your real commitments — personal, work, the shared demo
          calendar. Busy time on any of them hides the slot. New bookings are written to one.
        </p>
      </header>

      {connected && (
        <p className="rounded-lg bg-teal-50 px-4 py-2 text-sm text-teal-800">Calendar connected.</p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">Could not connect: {error}</p>
      )}

      <Card>
        {!configured ? (
          <p className="text-sm text-slate-600">
            Set <code className="rounded bg-slate-100 px-1">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="rounded bg-slate-100 px-1">GOOGLE_CLIENT_SECRET</code> to enable Google
            Calendar. Any Google account works.
          </p>
        ) : (
          <a
            href={`${BASE_PATH()}/api/calendars/google/connect`}
            className="inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
          >
            + Connect a Google account
          </a>
        )}
      </Card>

      {accounts.length > 0 && (
        <Card
          title="What customers can see"
          description="Your own confirmation email and calendar invite (.ics) always go out from Sothcare, with your Sothcare name and email as the organizer. This controls the Google side only."
        >
          <form action={setInviteAttendees} className="flex flex-wrap items-end gap-4">
            <div className="min-w-[18rem] flex-1">
              <Toggle
                name="inviteAttendeesOnCalendar"
                label="Also add the customer as an attendee on my Google Calendar event"
                defaultChecked={host.inviteAttendeesOnCalendar}
                hint="Off (recommended with a personal Gmail): the event stays private on your calendar and the customer never sees the connected Google address. On: Google may add the event to the customer's own calendar showing your connected account as the organizer."
              />
            </div>
            <Button variant="ghost">Save</Button>
          </form>
        </Card>
      )}

      {accounts.map((account) => (
        <Card key={account.id} title={account.email} description={`${account.provider} · ${account.calendars.length} calendars`}>
          {account.lastError && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Last sync failed: {account.lastError}. Reconnect this account.
            </p>
          )}
          <ul className="divide-y divide-slate-100">
            {account.calendars.map((calendar) => (
              <li key={calendar.id}>
                <form action={setCalendarFlags} className="flex flex-wrap items-center gap-4 py-3">
                  <input type="hidden" name="id" value={calendar.id} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                    {calendar.name}
                    {calendar.isPrimary && <span className="ml-2 text-xs text-slate-400">primary</span>}
                  </span>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" name="checkConflicts" defaultChecked={calendar.checkConflicts} />
                    Check for conflicts
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" name="isWriteTarget" defaultChecked={calendar.isWriteTarget} />
                    Add bookings here
                  </label>
                  <Button variant="ghost">Save</Button>
                </form>
              </li>
            ))}
          </ul>
          <form action={disconnectCalendarAccount} className="mt-3">
            <input type="hidden" name="id" value={account.id} />
            <Button variant="danger">Disconnect account</Button>
          </form>
        </Card>
      ))}
    </div>
  );
}
