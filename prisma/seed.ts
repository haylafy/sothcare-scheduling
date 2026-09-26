import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULT_TEMPLATES } from "../src/lib/templates";
import { DEMO_FOLLOW_UPS, DEMO_FOLLOWUP_OFFSET_MINUTES } from "../src/lib/demo-followups";
import { dbSslConfig } from "../src/lib/db-ssl";

try {
  process.loadEnvFile(".env");
} catch {
  /* .env is optional when the environment is already populated */
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ssl: dbSslConfig(process.env.DATABASE_URL),
  }),
});

/**
 * Seeds one organization, one host and a working set of event types,
 * availability and workflows — enough to open the booking page and book.
 */
async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "sothcare" },
    update: {},
    create: { name: "Sothcare LLC", slug: "sothcare" },
  });

  // Keyed on the email, not the slug: the owner renamed the booking-page slug
  // in the dashboard (salmaan -> sothcare) and a slug lookup then tried to
  // create a second host with the same email, which took every boot down
  // with a unique-constraint error. The email is the stable identity here;
  // `update: {}` means an existing host is never touched by the seed.
  const host = await prisma.host.upsert({
    where: { email: "admin@sothcare.com" },
    update: {},
    create: {
      organizationId: organization.id,
      externalUserId: "sothcare-user-1",
      name: "Salmaan Abdullahi",
      email: "admin@sothcare.com",
      slug: "salmaan",
      timezone: "America/Chicago",
      headline: "Book time with Sothcare",
      welcomeText:
        "Pick a time that works and we'll walk through the parts of Sothcare that matter to your agency.",
      brandColor: "#0F766E",
      // Real Sothcare logo, served from the live app -- keeps this in sync
      // with the actual brand asset instead of a copy that can drift.
      logoUrl: "https://app.sothcare.com/logo.png",
    },
  });

  const schedule = await prisma.schedule.upsert({
    where: { id: `${host.id}-default` },
    update: {},
    create: {
      id: `${host.id}-default`,
      hostId: host.id,
      name: "Demo hours",
      timezone: "America/Chicago",
      isDefault: true,
      rules: {
        // Monday through Saturday, 9:00–17:00 Central.
        create: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startMinute: 9 * 60,
          endMinute: 17 * 60,
        })),
      },
    },
  });

  const demo = await prisma.eventType.upsert({
    where: { hostId_slug: { hostId: host.id, slug: "20-min-demo" } },
    update: {},
    create: {
      hostId: host.id,
      scheduleId: schedule.id,
      slug: "20-min-demo",
      title: "Sothcare 20-Min Demo",
      description:
        "A focused walkthrough of Sothcare for your license type — 245D, 144G, home health or personal care.",
      durationMinutes: 20,
      slotIntervalMinutes: 15,
      bufferAfterMinutes: 10,
      minimumNoticeMinutes: 120,
      rollingDays: 45,
      locationType: "GOOGLE_MEET",
      questions: {
        create: [
          {
            label: "Which license do you operate under?",
            type: "SELECT",
            required: true,
            options: ["245D", "144G assisted living", "Home health (Medicare)", "Personal care", "Other"],
            position: 0,
          },
          { label: "How many houses or locations?", type: "TEXT", required: false, position: 1 },
        ],
      },
    },
  });

  await prisma.eventType.upsert({
    where: { hostId_slug: { hostId: host.id, slug: "implementation" } },
    update: {},
    create: {
      hostId: host.id,
      scheduleId: schedule.id,
      slug: "implementation",
      title: "Implementation call",
      description: "For agencies already onboarding — setup, imports and training.",
      durationMinutes: 45,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 10,
      minimumNoticeMinutes: 720,
      locationType: "GOOGLE_MEET",
    },
  });

  await prisma.eventType.upsert({
    where: { hostId_slug: { hostId: host.id, slug: "group-orientation" } },
    update: {},
    create: {
      hostId: host.id,
      scheduleId: schedule.id,
      slug: "group-orientation",
      title: "Caregiver orientation (group)",
      description: "Open session for agency staff getting started on the mobile app.",
      durationMinutes: 60,
      slotIntervalMinutes: 60,
      seatsPerSlot: 12,
      maxBookingsPerDay: 24,
      locationType: "GOOGLE_MEET",
    },
  });

  const workflows = [
    {
      name: "Reminder — 24 hours before",
      trigger: "BEFORE_EVENT" as const,
      offsetMinutes: 1440,
      action: "EMAIL_INVITEE" as const,
      template: DEFAULT_TEMPLATES.reminder24h,
    },
    {
      name: "Reminder — 1 hour before",
      trigger: "BEFORE_EVENT" as const,
      offsetMinutes: 60,
      action: "EMAIL_INVITEE" as const,
      template: DEFAULT_TEMPLATES.reminder1h,
    },
    {
      name: "Heads-up to host — 15 minutes before",
      trigger: "BEFORE_EVENT" as const,
      offsetMinutes: 15,
      action: "EMAIL_HOST" as const,
      template: {
        subject: "In 15 minutes: {{event_title}} with {{invitee_name}}",
        body: "{{invitee_name}} ({{invitee_email}}) at {{event_time}}.\n\nNotes: {{invitee_notes}}\n{{booking_url}}",
      },
    },
    {
      name: "Follow-up after the meeting",
      trigger: "AFTER_EVENT" as const,
      offsetMinutes: 60,
      action: "EMAIL_INVITEE" as const,
      template: DEFAULT_TEMPLATES.followUp,
    },
    // Outcome-specific demo follow-ups, one hour after the HOST marks the
    // booking. NOTE these overlap with "Follow-up after the meeting" above,
    // which is condition: ANY -- a host who wants only the outcome-specific
    // copy should deactivate that one in /dashboard/workflows. The seed does
    // not deactivate it automatically: it is an existing host-visible setting
    // and turning it off is the host's call, not a migration's.
    ...DEMO_FOLLOW_UPS.map((f) => ({
      name: f.name,
      trigger: "AFTER_ATTENDANCE_MARKED" as const,
      offsetMinutes: DEMO_FOLLOWUP_OFFSET_MINUTES,
      action: "EMAIL_INVITEE" as const,
      condition: f.condition,
      template: { subject: f.subject, body: f.body },
    })),
  ];

  for (const config of workflows) {
    const existing = await prisma.workflow.findFirst({ where: { hostId: host.id, name: config.name } });
    if (existing) continue;
    await prisma.workflow.create({
      data: {
        hostId: host.id,
        name: config.name,
        trigger: config.trigger,
        offsetMinutes: config.offsetMinutes,
        // Defaults to ANY in the schema; only the outcome-specific follow-ups
        // set it.
        condition: "condition" in config ? config.condition : undefined,
        allEventTypes: true,
        steps: {
          create: {
            action: config.action,
            subject: config.template.subject,
            body: config.template.body,
            position: 0,
          },
        },
      },
    });
  }

  console.log(`Seeded ${organization.name} / ${host.name} — /book/${host.slug}/${demo.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
