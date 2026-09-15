import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { saveSchedule, addDateOverride, deleteDateOverride } from "../actions";
import { Card, TextInput, Select, Button, TIMEZONES, Label } from "@/components/form";

export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export default async function AvailabilityPage() {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile yet.</p>;

  const schedule = await prisma.schedule.findFirst({
    where: { hostId: host.id, isDefault: true },
    include: { rules: true, overrides: { orderBy: { date: "asc" } } },
  });
  if (!schedule) return <p className="text-sm text-slate-500">No schedule found — run the seed.</p>;

  const byDay = new Map(schedule.rules.map((r) => [r.dayOfWeek, r]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Availability</h1>
        <p className="text-sm text-slate-500">
          Working hours are stored in this schedule&apos;s timezone, so they hold through daylight saving.
        </p>
      </header>

      <Card title="Weekly hours">
        <form action={saveSchedule} className="space-y-4">
          <input type="hidden" name="scheduleId" value={schedule.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput name="name" label="Schedule name" defaultValue={schedule.name} />
            <Select name="timezone" label="Timezone" defaultValue={schedule.timezone} options={TIMEZONES} />
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {DAYS.map((day, index) => {
              const rule = byDay.get(index);
              return (
                <div key={day} className="flex flex-wrap items-center gap-3 py-3">
                  <label className="flex w-40 items-center gap-2">
                    <input type="checkbox" name={`enabled_${index}`} defaultChecked={!!rule} />
                    <span className="text-sm font-medium text-slate-800">{day}</span>
                  </label>
                  <input
                    type="time"
                    name={`start_${index}`}
                    defaultValue={toTime(rule?.startMinute ?? 9 * 60)}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                  <span className="text-slate-400">to</span>
                  <input
                    type="time"
                    name={`end_${index}`}
                    defaultValue={toTime(rule?.endMinute ?? 17 * 60)}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                </div>
              );
            })}
          </div>

          <Button>Save hours</Button>
        </form>
      </Card>

      <Card title="Date overrides" description="Holidays, conference days, a half day — these beat the weekly hours.">
        <ul className="mb-4 divide-y divide-slate-100">
          {schedule.overrides.length === 0 && (
            <li className="py-2 text-sm text-slate-500">No overrides.</li>
          )}
          {schedule.overrides.map((o) => {
            const windows = o.windows as Array<{ startMinute: number; endMinute: number }>;
            return (
              <li key={o.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-32 font-medium text-slate-800">
                  {DateTime.fromJSDate(o.date, { zone: "utc" }).toFormat("LLL d, yyyy")}
                </span>
                <span className="flex-1 text-slate-600">
                  {windows.length === 0
                    ? "Unavailable all day"
                    : windows.map((w) => `${toTime(w.startMinute)}–${toTime(w.endMinute)}`).join(", ")}
                  {o.note ? ` · ${o.note}` : ""}
                </span>
                <form action={deleteDateOverride}>
                  <input type="hidden" name="id" value={o.id} />
                  <Button variant="danger">Remove</Button>
                </form>
              </li>
            );
          })}
        </ul>

        <form action={addDateOverride} className="grid items-end gap-4 md:grid-cols-5">
          <input type="hidden" name="scheduleId" value={schedule.id} />
          <TextInput name="date" label="Date" type="date" required />
          <label className="block">
            <Label>From</Label>
            <input type="time" name="start" defaultValue="09:00" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <Label>To</Label>
            <input type="time" name="end" defaultValue="17:00" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <TextInput name="note" label="Note" placeholder="Thanksgiving" />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="unavailable" /> Off all day
            </label>
            <Button>Add</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
