import type { ReactNode } from "react";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600";

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold text-slate-600">{children}</span>;
}

export function TextInput(props: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  min?: number;
}) {
  return (
    <label className="block">
      <Label>{props.label}</Label>
      <input
        name={props.name}
        type={props.type ?? "text"}
        min={props.min}
        required={props.required}
        placeholder={props.placeholder}
        defaultValue={props.defaultValue ?? undefined}
        className={inputClass}
      />
      {props.hint && <span className="mt-1 block text-xs text-slate-400">{props.hint}</span>}
    </label>
  );
}

export function TextArea(props: {
  name: string;
  label: string;
  defaultValue?: string | null;
  rows?: number;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <Label>{props.label}</Label>
      <textarea
        name={props.name}
        rows={props.rows ?? 4}
        defaultValue={props.defaultValue ?? undefined}
        className={`${inputClass} ${props.mono ? "font-mono text-xs" : ""}`}
      />
      {props.hint && <span className="mt-1 block text-xs text-slate-400">{props.hint}</span>}
    </label>
  );
}

export function Select(props: {
  name: string;
  label: string;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <Label>{props.label}</Label>
      <select name={props.name} defaultValue={props.defaultValue} className={inputClass}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle(props: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 py-1">
      <input type="checkbox" name={props.name} defaultChecked={props.defaultChecked} className="mt-0.5" />
      <span>
        <span className="text-sm text-slate-700">{props.label}</span>
        {props.hint && <span className="block text-xs text-slate-400">{props.hint}</span>}
      </span>
    </label>
  );
}

export function Button({
  children,
  variant = "primary",
  type = "submit",
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger";
  type?: "submit" | "button";
}) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    ghost: "border border-slate-200 text-slate-700 hover:bg-slate-50",
    danger: "text-red-600 hover:bg-red-50",
  }[variant];
  return (
    <button type={type} className={`rounded-lg px-4 py-2 text-sm font-semibold ${styles}`}>
      {children}
    </button>
  );
}

export function Card({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      {title && <h2 className="text-base font-bold text-slate-900">{title}</h2>}
      {description && <p className="mt-1 mb-4 text-sm text-slate-500">{description}</p>}
      {!description && title && <div className="mb-4" />}
      {children}
    </section>
  );
}

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "UTC",
].map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }));
