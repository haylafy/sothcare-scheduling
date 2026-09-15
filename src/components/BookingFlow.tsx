"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";

export interface PublicQuestion {
  id: string;
  label: string;
  helpText?: string | null;
  type: "TEXT" | "TEXTAREA" | "EMAIL" | "PHONE" | "SELECT" | "MULTISELECT" | "CHECKBOX";
  required: boolean;
  options: string[];
}

export interface BookingFlowProps {
  basePath: string;
  hostSlug: string;
  eventSlug: string;
  eventTitle: string;
  durationMinutes: number;
  locationLabel: string;
  questions: PublicQuestion[];
  askPhone: boolean;
  /** Present when the visitor is moving an existing booking. */
  rescheduleUid?: string;
}

type DayMap = Record<string, string[]>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A short, familiar timezone list plus whatever the visitor is actually in. */
function timezoneOptions(current: string): string[] {
  const common = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "UTC",
  ];
  return Array.from(new Set([current, ...common]));
}

export default function BookingFlow(props: BookingFlowProps) {
  // Which times are on offer depends on the viewer's clock and timezone, so
  // nothing here can be rendered on the server without a hydration mismatch.
  // The component stays inert until it has mounted.
  const [mounted, setMounted] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [monthOffset, setMonthOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [days, setDays] = useState<DayMap>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = useCallback((path: string) => `${props.basePath}${path}`, [props.basePath]);

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setMounted(true);
  }, []);

  const month = useMemo(
    () => DateTime.now().setZone(timezone).startOf("month").plus({ months: monthOffset }),
    [timezone, monthOffset],
  );

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    setLoading(true);
    const from = month.startOf("month").toISODate()!;
    const to = month.endOf("month").toISODate()!;
    const params = new URLSearchParams({
      host: props.hostSlug,
      event: props.eventSlug,
      from,
      to,
      timezone,
    });

    fetch(api(`/api/public/slots?${params}`))
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDays(data.days ?? {});
      })
      .catch(() => !cancelled && setError("Could not load available times."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [mounted, month, timezone, refreshKey, props.hostSlug, props.eventSlug, api]);

  // Changing timezone re-labels every slot, so drop a stale selection.
  useEffect(() => {
    setSelectedSlot(null);
    setShowForm(false);
  }, [timezone]);

  const grid = useMemo(() => {
    const first = month.startOf("month");
    const startOffset = first.weekday % 7; // Luxon: Mon=1..Sun=7 -> Sun=0
    const cells: Array<DateTime | null> = Array(startOffset).fill(null);
    for (let d = 0; d < month.daysInMonth!; d += 1) cells.push(first.plus({ days: d }));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const slotsForDay = selectedDate ? (days[selectedDate] ?? []) : [];
  const todayIso = DateTime.now().setZone(timezone).toISODate();

  async function submit(form: FormData) {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);

    const answers: Record<string, string | string[] | boolean> = {};
    for (const q of props.questions) {
      if (q.type === "MULTISELECT") {
        answers[q.id] = form.getAll(`q_${q.id}`).map(String);
      } else if (q.type === "CHECKBOX") {
        answers[q.id] = form.get(`q_${q.id}`) === "on";
      } else {
        answers[q.id] = String(form.get(`q_${q.id}`) ?? "");
      }
    }

    const guests = String(form.get("guests") ?? "")
      .split(/[,\s]+/)
      .map((g) => g.trim())
      .filter(Boolean);

    const response = await fetch(api("/api/public/book"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host: props.hostSlug,
        event: props.eventSlug,
        start: selectedSlot,
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
        notes: String(form.get("notes") ?? ""),
        timezone,
        guests,
        answers,
      }),
    });

    const result = await response.json().catch(() => ({}));
    setSubmitting(false);

    if (!response.ok) {
      setError(result.error ?? "Something went wrong. Please try again.");
      if (response.status === 409) {
        // Someone else took it — drop the selection and reload the day.
        setSelectedSlot(null);
        setShowForm(false);
        setRefreshKey((k) => k + 1);
      }
      return;
    }
    window.location.href = result.redirectUrl;
  }

  async function submitReschedule() {
    if (!selectedSlot || !props.rescheduleUid) return;
    setSubmitting(true);
    setError(null);
    const response = await fetch(api(`/api/bookings/${props.rescheduleUid}/reschedule`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: selectedSlot }),
    });
    const result = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (!response.ok) {
      setError(result.error ?? "Could not move that booking.");
      return;
    }
    window.location.href = result.redirectUrl;
  }

  if (!mounted) {
    return (
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      {/* ---------------- Calendar ---------------- */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Select a date</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              className="brand-ring rounded-md px-2 py-1 text-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              disabled={monthOffset <= 0}
              onClick={() => setMonthOffset((m) => Math.max(0, m - 1))}
            >
              ‹
            </button>
            <span className="min-w-[9rem] text-center text-sm font-semibold">
              {month.toFormat("LLLL yyyy")}
            </span>
            <button
              type="button"
              aria-label="Next month"
              className="brand-ring rounded-md px-2 py-1 text-lg text-slate-500 hover:bg-slate-100"
              onClick={() => setMonthOffset((m) => m + 1)}
            >
              ›
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-400">
          {WEEKDAYS.map((d) => (
            <div key={d} className="pb-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1" aria-busy={loading}>
          {grid.map((cell, i) => {
            if (!cell) return <div key={`empty-${i}`} />;
            const iso = cell.toISODate()!;
            const available = (days[iso]?.length ?? 0) > 0;
            return (
              <button
                key={iso}
                type="button"
                disabled={!available}
                data-available={available}
                data-selected={selectedDate === iso}
                className="day disabled:cursor-default"
                onClick={() => {
                  setSelectedDate(iso);
                  setSelectedSlot(null);
                  setShowForm(false);
                }}
              >
                <span className={iso === todayIso ? "underline underline-offset-4" : undefined}>
                  {cell.day}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-5 block text-xs font-medium text-slate-500">
          Time zone
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="brand-ring mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
          >
            {timezoneOptions(timezone).map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")} ({DateTime.now().setZone(tz).toFormat("ZZZZ")})
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ---------------- Times ---------------- */}
      <div className="md:border-l md:border-slate-200 md:pl-6">
        {!selectedDate && (
          <p className="text-sm text-slate-500">
            {loading ? "Loading available times…" : "Pick a day to see open times."}
          </p>
        )}

        {selectedDate && !showForm && (
          <>
            <h2 className="mb-3 text-sm font-semibold">
              {DateTime.fromISO(selectedDate, { zone: timezone }).toFormat("cccc, LLLL d")}
            </h2>
            <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
              {slotsForDay.length === 0 && <p className="text-sm text-slate-500">No times left this day.</p>}
              {slotsForDay.map((iso) => (
                <div key={iso} className="flex gap-2">
                  <button
                    type="button"
                    data-selected={selectedSlot === iso}
                    className="slot brand-ring flex-1"
                    onClick={() => setSelectedSlot(iso)}
                  >
                    {DateTime.fromISO(iso).setZone(timezone).toFormat("h:mm a")}
                  </button>
                  {selectedSlot === iso && (
                    <button
                      type="button"
                      className="brand-bg brand-ring flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
                      onClick={() => (props.rescheduleUid ? submitReschedule() : setShowForm(true))}
                      disabled={submitting}
                    >
                      {submitting ? "Working…" : props.rescheduleUid ? "Confirm" : "Next"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---------------- Details form ---------------- */}
        {showForm && selectedSlot && (
          <form
            action={submit}
            className="space-y-3"
          >
            <div className="mb-1">
              <button
                type="button"
                className="text-xs font-medium text-slate-500 hover:underline"
                onClick={() => setShowForm(false)}
              >
                ← Back
              </button>
              <p className="mt-1 text-sm font-semibold">
                {DateTime.fromISO(selectedSlot).setZone(timezone).toFormat("cccc, LLLL d 'at' h:mm a")}
              </p>
            </div>

            <Field label="Name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            {props.askPhone && <Field label="Phone number" name="phone" type="tel" required />}

            {props.questions.map((q) => (
              <QuestionField key={q.id} question={q} />
            ))}

            <label className="block text-xs font-medium text-slate-600">
              Anything we should know?
              <textarea
                name="notes"
                rows={3}
                className="brand-ring mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-xs font-medium text-slate-600">
              Add guests (comma-separated emails)
              <input
                name="guests"
                className="brand-ring mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="brand-bg brand-ring w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              {submitting ? "Scheduling…" : "Schedule event"}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Field(props: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {props.label}
      {props.required && <span className="text-red-500"> *</span>}
      <input
        name={props.name}
        type={props.type ?? "text"}
        required={props.required}
        className="brand-ring mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}

function QuestionField({ question }: { question: PublicQuestion }) {
  const name = `q_${question.id}`;
  const labelNode = (
    <>
      {question.label}
      {question.required && <span className="text-red-500"> *</span>}
      {question.helpText && <span className="block font-normal text-slate-400">{question.helpText}</span>}
    </>
  );

  if (question.type === "TEXTAREA") {
    return (
      <label className="block text-xs font-medium text-slate-600">
        {labelNode}
        <textarea
          name={name}
          rows={3}
          required={question.required}
          className="brand-ring mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
    );
  }

  if (question.type === "SELECT" || question.type === "MULTISELECT") {
    return (
      <label className="block text-xs font-medium text-slate-600">
        {labelNode}
        <select
          name={name}
          multiple={question.type === "MULTISELECT"}
          required={question.required}
          className="brand-ring mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {question.type === "SELECT" && <option value="">Choose one…</option>}
          {question.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (question.type === "CHECKBOX") {
    return (
      <label className="flex items-start gap-2 text-xs font-medium text-slate-600">
        <input type="checkbox" name={name} required={question.required} className="mt-0.5" />
        <span>{labelNode}</span>
      </label>
    );
  }

  const inputType = question.type === "EMAIL" ? "email" : question.type === "PHONE" ? "tel" : "text";
  return (
    <label className="block text-xs font-medium text-slate-600">
      {labelNode}
      <input
        name={name}
        type={inputType}
        required={question.required}
        className="brand-ring mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}
