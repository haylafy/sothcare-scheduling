-- Per-host opt-in for listing the invitee as an attendee on the Google Calendar
-- event. Default off so a personal Gmail write-target never shows up as the
-- organizer on a customer's own calendar.
ALTER TABLE "Host" ADD COLUMN "inviteAttendeesOnCalendar" BOOLEAN NOT NULL DEFAULT false;
