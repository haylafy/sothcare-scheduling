-- Sothcare Scheduling — initial schema

CREATE TYPE "LocationType" AS ENUM ('GOOGLE_MEET', 'PHONE_HOST_CALLS', 'PHONE_INVITEE_CALLS', 'IN_PERSON', 'CUSTOM');
CREATE TYPE "QuestionType" AS ENUM ('TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'SELECT', 'MULTISELECT', 'CHECKBOX');
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'MICROSOFT', 'CALDAV');
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED');
CREATE TYPE "WorkflowTrigger" AS ENUM ('BOOKING_CREATED', 'BEFORE_EVENT', 'AFTER_EVENT', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED');
CREATE TYPE "WorkflowAction" AS ENUM ('EMAIL_INVITEE', 'EMAIL_HOST', 'EMAIL_CUSTOM', 'WEBHOOK');
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TABLE "Host" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalUserId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "headline" TEXT,
    "welcomeText" TEXT,
    "avatarUrl" TEXT,
    "logoUrl" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#0F766E',
    "accentTextOn" TEXT NOT NULL DEFAULT '#FFFFFF',
    "pageBackground" TEXT NOT NULL DEFAULT '#F6F7F9',
    "customCss" TEXT,
    "showPoweredBy" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Host_externalUserId_key" ON "Host"("externalUserId");
CREATE UNIQUE INDEX "Host_slug_key" ON "Host"("slug");
CREATE INDEX "Host_organizationId_idx" ON "Host"("organizationId");

CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Schedule_hostId_idx" ON "Schedule"("hostId");

CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AvailabilityRule_scheduleId_dayOfWeek_idx" ON "AvailabilityRule"("scheduleId", "dayOfWeek");

CREATE TABLE "DateOverride" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "windows" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    CONSTRAINT "DateOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DateOverride_scheduleId_date_key" ON "DateOverride"("scheduleId", "date");

CREATE TABLE "EventType" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#0F766E',
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 240,
    "rollingDays" INTEGER NOT NULL DEFAULT 60,
    "maxBookingsPerDay" INTEGER,
    "seatsPerSlot" INTEGER NOT NULL DEFAULT 1,
    "locationType" "LocationType" NOT NULL DEFAULT 'GOOGLE_MEET',
    "locationValue" TEXT,
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "redirectUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventType_hostId_slug_key" ON "EventType"("hostId", "slug");
CREATE INDEX "EventType_hostId_idx" ON "EventType"("hostId");

CREATE TABLE "BookingQuestion" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "QuestionType" NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BookingQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BookingQuestion_eventTypeId_idx" ON "BookingQuestion"("eventTypeId");

CREATE TABLE "CalendarAccount" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "provider" "CalendarProvider" NOT NULL DEFAULT 'GOOGLE',
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarAccount_hostId_provider_email_key" ON "CalendarAccount"("hostId", "provider", "email");
CREATE INDEX "CalendarAccount_hostId_idx" ON "CalendarAccount"("hostId");

CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "checkConflicts" BOOLEAN NOT NULL DEFAULT true,
    "isWriteTarget" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Calendar_accountId_externalId_key" ON "Calendar"("accountId", "externalId");
CREATE INDEX "Calendar_accountId_idx" ON "Calendar"("accountId");

CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "inviteeName" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "inviteePhone" TEXT,
    "inviteeTimezone" TEXT NOT NULL,
    "inviteeNotes" TEXT,
    "guestEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answers" JSONB NOT NULL DEFAULT '{}',
    "locationType" "LocationType" NOT NULL,
    "locationDetail" TEXT,
    "meetingUrl" TEXT,
    "externalEventId" TEXT,
    "externalCalendarId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledBy" TEXT,
    "rescheduledFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Booking_uid_key" ON "Booking"("uid");
CREATE UNIQUE INDEX "Booking_rescheduledFromId_key" ON "Booking"("rescheduledFromId");
CREATE INDEX "Booking_hostId_startsAt_idx" ON "Booking"("hostId", "startsAt");
CREATE INDEX "Booking_eventTypeId_startsAt_idx" ON "Booking"("eventTypeId", "startsAt");
CREATE INDEX "Booking_status_startsAt_idx" ON "Booking"("status", "startsAt");

CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "WorkflowTrigger" NOT NULL,
    "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allEventTypes" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Workflow_hostId_idx" ON "Workflow"("hostId");

CREATE TABLE "WorkflowEventType" (
    "workflowId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    CONSTRAINT "WorkflowEventType_pkey" PRIMARY KEY ("workflowId", "eventTypeId")
);

CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "action" "WorkflowAction" NOT NULL DEFAULT 'EMAIL_INVITEE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT,
    "body" TEXT,
    "toOverride" TEXT,
    "webhookUrl" TEXT,
    "includeIcs" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkflowStep_workflowId_idx" ON "WorkflowStep"("workflowId");

CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkflowRun_workflowId_bookingId_key" ON "WorkflowRun"("workflowId", "bookingId");
CREATE INDEX "WorkflowRun_status_scheduledFor_idx" ON "WorkflowRun"("status", "scheduledFor");

CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "kind" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationLog_bookingId_idx" ON "NotificationLog"("bookingId");
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- Foreign keys
ALTER TABLE "Host" ADD CONSTRAINT "Host_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DateOverride" ADD CONSTRAINT "DateOverride_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventType" ADD CONSTRAINT "EventType_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventType" ADD CONSTRAINT "EventType_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingQuestion" ADD CONSTRAINT "BookingQuestion_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarAccount" ADD CONSTRAINT "CalendarAccount_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CalendarAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowEventType" ADD CONSTRAINT "WorkflowEventType_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowEventType" ADD CONSTRAINT "WorkflowEventType_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
