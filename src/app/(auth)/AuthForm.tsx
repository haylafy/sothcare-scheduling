"use client";

import Link from "next/link";
import { useActionState } from "react";

type AuthState = { error: string; email?: string; name?: string } | undefined;
type Action = (prev: unknown, formData: FormData) => Promise<AuthState | void>;

export function AuthForm({
  action,
  mode,
}: {
  action: Action;
  mode: "login" | "signup";
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isSignup = mode === "signup";

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="text-2xl font-bold text-slate-900">
        {isSignup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {isSignup
          ? "Set up your booking page in about a minute."
          : "Sign in to manage your availability and bookings."}
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        {isSignup && (
          <Field
            label="Your name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Jordan Ellis"
            defaultValue={state?.name ?? ""}
            required
          />
        )}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          defaultValue={state?.email ?? ""}
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          placeholder={isSignup ? "At least 10 characters" : ""}
          hint={isSignup ? "At least 10 characters." : undefined}
          required
        />
        {isSignup && (
          <input
            type="hidden"
            name="timezone"
            value={Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"}
          />
        )}

        {state?.error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
        >
          {pending ? "Just a moment…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-teal-700 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-semibold text-teal-700 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
