import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { updateEventType, addQuestion, deleteQuestion } from "../../actions";
import { Card, TextInput, TextArea, Select, Toggle, Button } from "@/components/form";
import { BASE_PATH } from "@/lib/env";
import { LOCATION_OPTIONS } from "@/lib/locations";

export const dynamic = "force-dynamic";

export default async function EditEventType({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = await getCurrentHost();
  if (!host) notFound();

  const [eventType, schedules] = await Promise.all([
    prisma.eventType.findFirst({
      where: { id, hostId: host.id },
      include: { questions: { orderBy: { position: "asc" } } },
    }),
    prisma.schedule.findMany({ where: { hostId: host.id }, orderBy: { name: "asc" } }),
  ]);
  if (!eventType) notFound();

  return (
    <div className="space-y-6">
      <Link href={`${BASE_PATH()}/dashboard/event-types`} className="text-sm text-slate-500 hover:underline">
        ← All event types
      </Link>

      <Card title={eventType.title} description={`/book/${host.slug}/${eventType.slug}`}>
        <form action={updateEventType} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={eventType.id} />
          <TextInput name="title" label="Name" defaultValue={eventType.title} required />
          <TextInput name="slug" label="URL slug" defaultValue={eventType.slug} />
          <div className="md:col-span-2">
            <TextArea name="description" label="Description" defaultValue={eventType.description} rows={3} />
          </div>

          <TextInput name="durationMinutes" label="Duration (min)" type="number" defaultValue={eventType.durationMinutes} min={5} />
          <TextInput
            name="slotIntervalMinutes"
            label="Start times every (min)"
            type="number"
            defaultValue={eventType.slotIntervalMinutes}
            min={5}
            hint="15 gives :00 :15 :30 :45 start times."
          />
          <TextInput name="bufferBeforeMinutes" label="Buffer before (min)" type="number" defaultValue={eventType.bufferBeforeMinutes} min={0} />
          <TextInput name="bufferAfterMinutes" label="Buffer after (min)" type="number" defaultValue={eventType.bufferAfterMinutes} min={0} />
          <TextInput
            name="minimumNoticeMinutes"
            label="Minimum notice (min)"
            type="number"
            defaultValue={eventType.minimumNoticeMinutes}
            min={0}
            hint="240 = nobody can book less than 4 hours out."
          />
          <TextInput name="rollingDays" label="Bookable days ahead" type="number" defaultValue={eventType.rollingDays} min={1} />
          <TextInput
            name="maxBookingsPerDay"
            label="Max bookings per day"
            type="number"
            defaultValue={eventType.maxBookingsPerDay ?? ""}
            hint="Leave blank for no cap."
          />
          <TextInput
            name="seatsPerSlot"
            label="Seats per slot"
            type="number"
            defaultValue={eventType.seatsPerSlot}
            min={1}
            hint="Above 1 turns this into a group session."
          />

          <Select
            name="locationType"
            label="Location"
            defaultValue={eventType.locationType}
            options={LOCATION_OPTIONS}
          />
          <TextInput
            name="locationValue"
            label="Location detail"
            defaultValue={eventType.locationValue}
            hint="Address, phone number, or a link. For Zoom/Teams paste your personal meeting link — it's only shared with people who book."
          />

          <Select
            name="scheduleId"
            label="Availability schedule"
            defaultValue={eventType.scheduleId ?? ""}
            options={[
              { value: "", label: "Use my default schedule" },
              ...schedules.map((s) => ({ value: s.id, label: `${s.name} (${s.timezone})` })),
            ]}
          />
          <TextInput name="color" label="Colour" type="color" defaultValue={eventType.color} />
          <div className="md:col-span-2">
            <TextInput
              name="redirectUrl"
              label="Redirect after booking"
              defaultValue={eventType.redirectUrl}
              hint="Optional — send invitees to a thank-you page of your own."
            />
          </div>

          <div className="md:col-span-2 space-y-1">
            <Toggle name="isActive" label="Accepting bookings" defaultChecked={eventType.isActive} />
            <Toggle
              name="isHidden"
              label="Hidden from my booking page"
              defaultChecked={eventType.isHidden}
              hint="Still reachable by direct link."
            />
            <Toggle
              name="requiresConfirmation"
              label="I confirm each booking manually"
              defaultChecked={eventType.requiresConfirmation}
            />
          </div>

          <div className="md:col-span-2">
            <Button>Save changes</Button>
          </div>
        </form>
      </Card>

      <Card title="Booking questions" description="Asked on the booking form, stored with the booking.">
        <ul className="mb-4 divide-y divide-slate-100">
          {eventType.questions.length === 0 && (
            <li className="py-2 text-sm text-slate-500">No custom questions yet.</li>
          )}
          {eventType.questions.map((q) => (
            <li key={q.id} className="flex items-center gap-3 py-2">
              <span className="flex-1 text-sm text-slate-800">
                {q.label}
                {q.required && <span className="text-red-500"> *</span>}
                <span className="ml-2 text-xs text-slate-400">{q.type.toLowerCase()}</span>
              </span>
              <form action={deleteQuestion}>
                <input type="hidden" name="id" value={q.id} />
                <Button variant="danger">Remove</Button>
              </form>
            </li>
          ))}
        </ul>

        <form action={addQuestion} className="grid gap-4 md:grid-cols-4">
          <input type="hidden" name="eventTypeId" value={eventType.id} />
          <TextInput name="label" label="Question" placeholder="Which license type?" required />
          <Select
            name="type"
            label="Type"
            options={[
              { value: "TEXT", label: "Short text" },
              { value: "TEXTAREA", label: "Long text" },
              { value: "EMAIL", label: "Email" },
              { value: "PHONE", label: "Phone" },
              { value: "SELECT", label: "Dropdown" },
              { value: "MULTISELECT", label: "Multi-select" },
              { value: "CHECKBOX", label: "Checkbox" },
            ]}
          />
          <TextInput name="options" label="Options (comma-separated)" placeholder="245D, 144G, Home health" />
          <div className="flex items-end gap-3">
            <Toggle name="required" label="Required" />
            <Button>Add</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
