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

  // Several windows per day are allowed (e.g. 9:00–11:00 and 13:00–17:00);
  // each is its own AvailabilityRule row. Sorted so the form is stable.
  const byDay = new Map<number, typeof schedule.rules>();
  for (const rule of [...schedule.rules].sort((a, b) => a.startMinute - b.startMinute)) {
    byDay.set(rule.dayOfWeek, [...(byDay.get(rule.dayOfWeek) ?? []), rule]);
  }
  const timeInput = "rounded-lg border border-slate-200 px-2 py-1.5 text-sm";

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

          <p className="text-xs text-slate-500">
            A day can have several windows, for example 9:00–11:00 and 13:00–17:00. Fill the blank row to add one,
            tick <span className="font-medium">remove</span> to drop one, and untick a day to take it off entirely.
            A window whose end is not after its start is ignored.
          </p>

          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {DAYS.map((day, index) => {
              const rules = byDay.get(index) ?? [];
              // Existing windows, then one spare blank row. Its name index is
              // rules.length so the action reads rows 0..n contiguously.
              const rows = [...rules.map((r) => ({ start: toTime(r.startMinute), end: toTime(r.endMinute) })), { start: "", end: "" }];
              return (
                <div key={day} className="flex flex-wrap items-start gap-3 py-3">
                  <label className="flex w-40 items-center gap-2 pt-1.5">
                    <input type="checkbox" name={`enabled_${index}`} defaultChecked={rules.length > 0} />
                    <span className="text-sm font-medium text-slate-800">{day}</span>
                  </label>
                  <div className="flex flex-col gap-2">
                    {rows.map((row, i) => {
                      const spare = i === rules.length;
                      return (
                        <div key={i} className="flex flex-wrap items-center gap-3">
                          <input
                            type="time"
                            name={`start_${index}_${i}`}
                            defaultValue={row.start}
                            aria-label={`${day} window ${i + 1} start`}
                            className={timeInput}
                          />
                          <span className="text-slate-400">to</span>
                          <input
                            type="time"
                            name={`end_${index}_${i}`}
                            defaultValue={row.end}
                            aria-label={`${day} window ${i + 1} end`}
                            className={timeInput}
                          />
                          {spare ? (
                            <span className="text-xs text-slate-400">add another window</span>
                          ) : (
                            <label className="flex items-center gap-1 text-xs text-slate-500">
                              <input type="checkbox" name={`remove_${index}_${i}`} /> remove
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
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
