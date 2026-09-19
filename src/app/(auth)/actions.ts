"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword, startSession, endSession } from "@/lib/session";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

const RESERVED_SLUGS = new Set([
  "api", "dashboard", "login", "signup", "book", "booking", "admin", "_next", "static",
]);

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Appends -2, -3 ... until the slug is free. */
async function uniqueSlug(base: string) {
  const root = base || "host";
  for (let i = 1; i < 500; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    if (RESERVED_SLUGS.has(candidate)) continue;
    const taken = await prisma.host.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error("Could not allocate a booking link");
}

const signupSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters"),
  timezone: z.string().trim().min(1).default("America/Chicago"),
});

export async function signup(_prev: unknown, formData: FormData) {
  // Echoed back on failure so a rejected password doesn't wipe the rest.
  const submitted = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  };
  const parsed = signupSchema.safeParse({
    ...submitted,
    password: formData.get("password"),
    timezone: formData.get("timezone") || "America/Chicago",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again", ...submitted };
  }
  const { name, email, password, timezone } = parsed.data;

  const existing = await prisma.host.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return {
      error: "An account with that email already exists. Try signing in instead.",
      ...submitted,
    };
  }

  const slug = await uniqueSlug(slugify(name));
  const passwordHash = await hashPassword(password);

  // Each standalone signup gets its own organization -- the multi-tenant
  // scoping the rest of the schema assumes, with a tenant of one.
  const host = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name, slug: await uniqueOrgSlug(tx, slugify(name)) },
    });

    const created = await tx.host.create({
      data: {
        organizationId: organization.id,
        name,
        email,
        slug,
        timezone,
        passwordHash,
        headline: `Book time with ${name}`,
      },
    });

    // A new account with no availability can't be booked at all, so give it
    // the same weekday 9-5 default a fresh Calendly account starts with.
    const schedule = await tx.schedule.create({
      data: { hostId: created.id, name: "Working hours", timezone, isDefault: true },
    });
    await tx.availabilityRule.createMany({
      data: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        scheduleId: schedule.id,
        dayOfWeek,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      })),
    });

    await tx.eventType.create({
      data: {
        hostId: created.id,
        scheduleId: schedule.id,
        slug: "30-min-meeting",
        title: "30 Minute Meeting",
        durationMinutes: 30,
      },
    });

    await tx.workflow.create({
      data: {
        hostId: created.id,
        name: "Reminder — 1 hour before",
        trigger: "BEFORE_EVENT",
        offsetMinutes: 60,
        steps: {
          create: {
            action: "EMAIL_INVITEE",
            subject: DEFAULT_TEMPLATES.reminder1h.subject,
            body: DEFAULT_TEMPLATES.reminder1h.body,
          },
        },
      },
    });

    return created;
  });

  await startSession(host.id);
  redirect("/dashboard");
}

async function uniqueOrgSlug(tx: { organization: { findUnique: (args: { where: { slug: string }; select: { id: true } }) => Promise<unknown> } }, base: string) {
  const root = base || "org";
  for (let i = 1; i < 500; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const taken = await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error("Could not allocate an organization");
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export async function login(_prev: unknown, formData: FormData) {
  // Echoed back on failure so a mistyped password doesn't also wipe the email.
  const email = String(formData.get("email") ?? "");
  const parsed = loginSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again", email };
  }

  const host = await prisma.host.findUnique({ where: { email: parsed.data.email } });
  // Same message either way: whether an email has an account here isn't
  // something an unauthenticated visitor should be able to probe for.
  const invalid = { error: "Email or password is incorrect", email };
  if (!host?.passwordHash) return invalid;
  if (!(await verifyPassword(parsed.data.password, host.passwordHash))) return invalid;
  if (!host.isActive) return { error: "That account is disabled", email };

  await startSession(host.id);
  redirect("/dashboard");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
